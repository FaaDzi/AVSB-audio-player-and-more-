package com.iemdreambracket.app

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.Build
import android.os.SystemClock
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.IOException
import java.io.OutputStream
import java.util.UUID

/**
 * §104 C: head tracking from Galaxy Buds' own motion sensor (Buds+ and later), the way Samsung's 360 Audio gets it.
 * Protocol from timschneeb/GalaxyBudsClient and AkbulutMirac/galaxy-buds-headtracker (both MIT): Samsung's management
 * service over RFCOMM, frames FD | size (10 bits, LE) | id | payload | CRC-16/XMODEM (LE) | DD.
 * Only the 360 Audio messages are sent: 124 spatial audio on/off, 195 attach / keep-alive / detach; 194 brings the data.
 * Events: "pose" {x, y, z, w, t} (game rotation vector, ~50 Hz), "state" {state, detail}.
 */
@CapacitorPlugin(
    name = "BudsHeadTracker",
    permissions = [Permission(alias = "bluetooth", strings = [Manifest.permission.BLUETOOTH_CONNECT])],
)
class BudsHeadTrackerPlugin : Plugin() {
    private val service: UUID = UUID.fromString("2e73a4ad-332d-41fc-90e2-16bef06523f2")
    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var running = false

    private fun adapter() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    private fun needsPermission() =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED

    /** Bonded earbuds that offer Samsung's management service: [{name, address}]. */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun find(call: PluginCall) {
        if (needsPermission()) return requestPermissionForAlias("bluetooth", call, "findAfterPermission")
        val list = JSArray()
        val bonded = try { adapter()?.bondedDevices ?: emptySet() } catch (e: SecurityException) { emptySet<BluetoothDevice>() }
        for (d in bonded) {
            val uuids = d.uuids?.map { it.uuid } ?: emptyList()
            // §115 A: Sony headphones (MDR v1/v2) are listed too; head tracking keeps to Samsung's
            val brand = when {
                service in uuids -> "samsung"
                SonyMdr.V2 in uuids -> "sony-v2"
                SonyMdr.V1 in uuids -> "sony"
                // a generic serial channel proves nothing on its own: the name has to say Revo too
                TanchjimRevo.SPP in uuids && (d.name ?: "").contains("TANCHJIM-REVO", ignoreCase = true) -> "tanchjim-revo"
                else -> null
            } ?: continue
            list.put(JSObject().put("name", d.name ?: "Earbuds").put("address", d.address).put("connected", isConnected(d)).put("brand", brand))
        }
        call.resolve(JSObject().put("devices", list))
    }

    /**
     * §115 A: what every connected Bluetooth device offers (its SDP service UUIDs), logged under "BudsProbe" and
     * returned, so the right protocol can be picked for buds we don't speak yet (KZ, Tanchjim: GAIA, BES, Bluetrum…).
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun probe(call: PluginCall) {
        if (needsPermission()) return requestPermissionForAlias("bluetooth", call, "probeAfterPermission")
        val list = JSArray()
        val bonded = try { adapter()?.bondedDevices ?: emptySet() } catch (e: SecurityException) { emptySet<BluetoothDevice>() }
        for (d in bonded) {
            if (!isConnected(d)) continue
            val uuids = d.uuids?.map { it.uuid.toString() } ?: emptyList()
            android.util.Log.i("BudsProbe", "${d.name} ${d.address} type=${d.type} class=${d.bluetoothClass?.deviceClass} uuids=$uuids")
            list.put(JSObject().put("name", d.name ?: "").put("address", d.address).put("uuids", JSArray(uuids)))
        }
        call.resolve(JSObject().put("devices", list))
    }

    @PermissionCallback
    private fun probeAfterPermission(call: PluginCall) {
        if (needsPermission()) call.reject("Allow Nearby devices so the app can look at your earbuds.")
        else probe(call)
    }

    /** §105 B: connected now, not only paired. BluetoothDevice.isConnected is hidden API: false when it can't be read. */
    private fun isConnected(d: BluetoothDevice): Boolean =
        try { d.javaClass.getMethod("isConnected").invoke(d) as? Boolean ?: false } catch (_: Exception) { false }

    @PermissionCallback
    private fun findAfterPermission(call: PluginCall) {
        if (needsPermission()) call.reject("Allow Nearby devices so the app can reach your earbuds' motion sensor.")
        else find(call)
    }

    /** Connects to the earbuds at `address` and starts the sensor stream. Resolves once connected. */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun start(call: PluginCall) {
        if (needsPermission()) return requestPermissionForAlias("bluetooth", call, "startAfterPermission")
        val address = call.getString("address") ?: return call.reject("No earbuds given")
        stopNow()
        Thread {
            try {
                val device = adapter()?.getRemoteDevice(address) ?: throw IOException("Bluetooth is off")
                try { adapter()?.cancelDiscovery() } catch (_: SecurityException) {}
                val s = connectSpp(device)
                socket = s
                running = true
                val out = s.outputStream
                send(out, SET_SPATIAL_AUDIO, byteArrayOf(1))
                send(out, SPATIAL_AUDIO_CONTROL, byteArrayOf(CTRL_ATTACH))
                state("connected", device.name ?: address)
                call.resolve()
                readLoop(s, out)
            } catch (e: Exception) {
                val wasRunning = running
                running = false
                closeQuietly()
                // a connect that never worked rejects the call; a stream that dropped later says so as an event
                if (!wasRunning) call.reject(e.message ?: "Could not reach the earbuds' sensor")
                else state("closed", e.message ?: "connection lost")
            }
        }.apply { name = "buds-headtracker"; isDaemon = true }.start()
    }

    @PermissionCallback
    private fun startAfterPermission(call: PluginCall) {
        if (needsPermission()) call.reject("Allow Nearby devices so the app can reach your earbuds' motion sensor.")
        else start(call)
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        stopNow()
        call.resolve()
    }

    private fun stopNow() {
        val s = socket ?: return
        running = false
        try {
            send(s.outputStream, SPATIAL_AUDIO_CONTROL, byteArrayOf(CTRL_DETACH))
            send(s.outputStream, SET_SPATIAL_AUDIO, byteArrayOf(0))
        } catch (_: IOException) {}
        closeQuietly()
    }

    private fun closeQuietly() {
        try { socket?.close() } catch (_: IOException) {}
        socket = null
    }

    private fun readLoop(s: BluetoothSocket, out: OutputStream) {
        val input = s.inputStream
        val chunk = ByteArray(1024)
        var buf = ByteArray(0)
        var lastKeepAlive = SystemClock.elapsedRealtime()
        while (running) {
            val now = SystemClock.elapsedRealtime()
            if (now - lastKeepAlive >= 2000) {
                send(out, SPATIAL_AUDIO_CONTROL, byteArrayOf(CTRL_KEEPALIVE))
                lastKeepAlive = now
            }
            // available() keeps the loop free to send keep-alives when the earbuds go quiet
            if (input.available() <= 0) { Thread.sleep(5); continue }
            val n = input.read(chunk)
            if (n < 0) throw IOException("The earbuds closed the connection")
            buf += chunk.copyOf(n)
            buf = handleFrames(buf)
        }
    }

    /** Takes every complete frame off the front of `buf`; returns what is left (a partial frame). */
    private fun handleFrames(start: ByteArray): ByteArray {
        var buf = start
        while (true) {
            val som = buf.indexOf(SOM)
            if (som < 0) return ByteArray(0)
            if (som > 0) buf = buf.copyOfRange(som, buf.size)
            if (buf.size < 3) return buf
            val size = ((buf[1].toInt() and 0xFF) or ((buf[2].toInt() and 0xFF) shl 8)) and 0x3FF
            val total = 3 + size + 1
            if (buf.size < total) return buf
            if (size < 3 || buf[total - 1] != EOM) { buf = buf.copyOfRange(1, buf.size); continue }
            val body = buf.copyOfRange(3, 1 + size)
            val crc = (buf[1 + size].toInt() and 0xFF) or ((buf[2 + size].toInt() and 0xFF) shl 8)
            buf = buf.copyOfRange(total, buf.size)
            if (crc16(body) != crc || body.isEmpty()) continue
            handle(body[0].toInt() and 0xFF, body.copyOfRange(1, body.size))
        }
    }

    private fun handle(id: Int, payload: ByteArray) {
        if (id == NOISE_CONTROLS_UPDATE && payload.isNotEmpty()) notifyListeners("noise", JSObject().put("mode", payload[0].toInt()))
        else if (id == SPATIAL_AUDIO_CONTROL && payload.isNotEmpty()) {
            when (payload[0].toInt()) {
                CTRL_ATTACH_OK -> state("attached", "")
                CTRL_DETACH_OK -> state("detached", "")
            }
        } else if (id == SPATIAL_AUDIO_DATA && payload.isNotEmpty()) {
            when (payload[0].toInt() and 0xFF) {
                DATA_GRV -> if (payload.size >= 9) {
                    fun s16(i: Int) = ((payload[i].toInt() and 0xFF) or (payload[i + 1].toInt() shl 8)).toShort() / 10000.0
                    notifyListeners("pose", JSObject()
                        .put("x", s16(1)).put("y", s16(3)).put("z", s16(5)).put("w", s16(7))
                        .put("t", SystemClock.elapsedRealtime()))
                }
                DATA_WEAR_ON -> state("wear-on", "")
                DATA_WEAR_OFF -> state("wear-off", "")
                DATA_STUCK -> state("stuck", "")
            }
        }
    }

    private fun state(state: String, detail: String) = notifyListeners("state", JSObject().put("state", state).put("detail", detail))

    /** Header bit 0x1000 is only on Galaxy Wearable's acknowledgements of status messages, never on settings (its own log). */
    private fun send(out: OutputStream, id: Int, payload: ByteArray) {
        val body = byteArrayOf(id.toByte()) + payload
        val size = body.size + 2
        val crc = crc16(body)
        synchronized(this) {
            out.write(byteArrayOf(SOM, (size and 0xFF).toByte(), (size shr 8).toByte()) + body +
                byteArrayOf((crc and 0xFF).toByte(), (crc shr 8).toByte(), EOM))
            out.flush()
        }
    }

    /**
     * Galaxy Wearable holds the buds' one control channel; our first try fails but drops its hold for ~5 s
     * (logcat, 2026-11-27), so a quick retry gets the channel. Wearable takes it back on its own afterwards.
     */
    @SuppressLint("MissingPermission")
    private fun connectSpp(device: android.bluetooth.BluetoothDevice, uuid: UUID = service): BluetoothSocket {
        var last: IOException? = null
        repeat(3) { attempt ->
            val s = device.createRfcommSocketToServiceRecord(uuid)
            try {
                s.connect()
                return s
            } catch (e: IOException) {
                last = e
                try { s.close() } catch (_: IOException) {}
                if (attempt < 2) Thread.sleep(250)
            }
        }
        throw last ?: IOException("Could not reach the earbuds")
    }

    /** Hidden BluetoothDevice.getBatteryLevel (the phone's own figure, from the headset's HFP report); null when unknown. */
    private fun systemBattery(d: BluetoothDevice): Int? =
        try { (d.javaClass.getMethod("getBatteryLevel").invoke(d) as? Int)?.takeIf { it in 0..100 } } catch (_: Exception) { null }

    /** §117: connected pairs with the driver that speaks to each (or none): [{name, address, driver, tested, fastPair, battery}]. */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun wirelessFind(call: PluginCall) {
        if (needsPermission()) return requestPermissionForAlias("bluetooth", call, "wirelessFindAfterPermission")
        val list = JSArray()
        val bonded = try { adapter()?.bondedDevices ?: emptySet() } catch (e: SecurityException) { emptySet<BluetoothDevice>() }
        for (d in bonded) {
            if (!isConnected(d)) continue
            val uuids = d.uuids?.map { it.uuid } ?: emptyList()
            val driver = Wireless.driverFor(d.name ?: "", uuids)
            list.put(JSObject().put("name", d.name ?: "Bluetooth").put("address", d.address)
                .put("driver", driver?.id ?: "none").put("tested", driver == null || driver.id in Wireless.TESTED)
                .put("fastPair", FastPairBattery.UUID_STREAM in uuids).put("battery", systemBattery(d)))
        }
        call.resolve(JSObject().put("devices", list))
    }

    @PermissionCallback
    private fun wirelessFindAfterPermission(call: PluginCall) {
        if (needsPermission()) call.reject("Allow Nearby devices so the app can reach your earbuds.")
        else wirelessFind(call)
    }

    /**
     * §118: a connection stays open ~6 s after use, so a run of changes (a dragged slider, a preset) doesn't fight
     * Galaxy Wearable / Sound Connect for the channel every time (that took ~1 s each). Closed after, so their apps get
     * it back. What arrived while it sat idle is thrown away before the next use (old answers can't confirm new asks).
     */
    private val held = HashMap<String, Pair<BluetoothSocket, Long>>()
    @Volatile private var closer: Thread? = null

    @SuppressLint("MissingPermission")
    private fun take(device: BluetoothDevice, uuid: UUID): BluetoothSocket {
        val reused = synchronized(held) { held.remove("${device.address}|$uuid")?.first }
        if (reused != null && reused.isConnected) {
            try { while (reused.inputStream.available() > 0) reused.inputStream.skip(reused.inputStream.available().toLong()) } catch (_: IOException) {}
            return reused
        }
        try { reused?.close() } catch (_: IOException) {}
        return connectSpp(device, uuid)
    }

    private fun giveBack(device: BluetoothDevice, uuid: UUID, s: BluetoothSocket) {
        synchronized(held) { held.put("${device.address}|$uuid", s to SystemClock.elapsedRealtime())?.first?.takeIf { it !== s }?.let { try { it.close() } catch (_: IOException) {} } }
        if (closer?.isAlive == true) return
        closer = Thread {
            while (true) {
                Thread.sleep(1000)
                val done = synchronized(held) {
                    val now = SystemClock.elapsedRealtime()
                    held.entries.removeAll { (_, v) -> (now - v.second > 6000).also { old -> if (old) try { v.first.close() } catch (_: IOException) {} } }
                    held.isEmpty()
                }
                if (done) break
            }
        }.apply { name = "wireless-close"; isDaemon = true; start() }
    }

    private fun driverOf(address: String): Pair<BluetoothDevice, WirelessDriver?> {
        val d = adapter()?.getRemoteDevice(address) ?: throw IOException("Bluetooth is off")
        @SuppressLint("MissingPermission") val name = d.name ?: ""
        @SuppressLint("MissingPermission") val uuids = d.uuids?.map { it.uuid } ?: emptyList()
        return d to Wireless.driverFor(name, uuids)
    }

    /** §117: one pair's state through its driver (one short connection), plus Fast Pair battery when it offers that. */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun wirelessRead(call: PluginCall) {
        if (needsPermission()) return call.reject("Allow Nearby devices so the app can reach your earbuds.")
        val address = call.getString("address") ?: return call.reject("No earbuds given")
        Thread {
            val log = StringBuilder()
            try {
                val (device, driver) = driverOf(address)
                try { adapter()?.cancelDiscovery() } catch (_: SecurityException) {}
                var out = JSObject()
                if (driver != null) {
                    // §120: a read opens its own connection: Galaxy Buds send their full status only when one opens
                    synchronized(held) { held.remove("${device.address}|${driver.uuid}")?.first?.let { try { it.close() } catch (_: IOException) {} } }
                    val s = take(device, driver.uuid)
                    try { out = driver.read(s, log); giveBack(device, driver.uuid, s) } catch (e: Exception) { try { s.close() } catch (_: IOException) {}; throw e }
                }
                if (!out.has("battery") && FastPairBattery.UUID_STREAM in (device.uuids?.map { it.uuid } ?: emptyList())) {
                    try {
                        val s = connectSpp(device, FastPairBattery.UUID_STREAM)
                        try { FastPairBattery.read(s, log)?.let { out.put("battery", it) } } finally { try { s.close() } catch (_: IOException) {} }
                    } catch (_: Exception) { /* battery is a bonus */ }
                }
                if (!out.has("battery")) systemBattery(device)?.let { out.put("battery", JSObject().put("single", it)) }
                android.util.Log.i("BudsControl", "read ${driver?.id ?: "none"}:$log")
                call.resolve(out)
            } catch (e: Exception) {
                android.util.Log.i("BudsControl", "read failed: ${e.message};$log")
                call.reject(e.message ?: "Could not reach the earbuds")
            }
        }.apply { name = "wireless-read"; isDaemon = true }.start()
    }

    /** §117: one setting (`key` noise | ambient | game | connection, `value`, optional `level`, `voice`); resolves with what the pair confirmed. */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun wirelessSet(call: PluginCall) {
        if (needsPermission()) return call.reject("Allow Nearby devices so the app can reach your earbuds.")
        val address = call.getString("address") ?: return call.reject("No earbuds given")
        val key = call.getString("key") ?: return call.reject("No setting given")
        val value = call.getInt("value") ?: return call.reject("No value")
        val level = call.getInt("level")
        val voice = call.getBoolean("voice")
        Thread {
            val log = StringBuilder()
            try {
                val (device, driver) = driverOf(address)
                if (driver == null) throw IOException("These earbuds aren't ones we can control yet")
                try { adapter()?.cancelDiscovery() } catch (_: SecurityException) {}
                val s = take(device, driver.uuid)
                val out = try {
                    driver.set(s, key, value, level, voice, log).also { giveBack(device, driver.uuid, s) }
                } catch (e: Exception) {
                    // a refusal leaves the line usable; a broken line is dropped
                    if (s.isConnected && e !is java.io.IOException) giveBack(device, driver.uuid, s) else try { s.close() } catch (_: IOException) {}
                    throw e
                }
                android.util.Log.i("BudsControl", "set ${driver.id} $key=$value level=$level voice=$voice:$log")
                call.resolve(out)
            } catch (e: Exception) {
                android.util.Log.i("BudsControl", "set failed: ${e.message};$log")
                call.reject(e.message ?: "Could not reach the earbuds")
            }
        }.apply { name = "wireless-set"; isDaemon = true }.start()
    }

    /**
     * §115 A: read-only questions to an unknown pair, to learn whether it speaks a protocol we know. For each service
     * UUID given, connects and sends each frame (hex), logging everything that comes back under "BudsProbe". Only
     * questions go out (version, serial, firmware); nothing that changes a setting.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun ask(call: PluginCall) {
        if (needsPermission()) return call.reject("Allow Nearby devices so the app can reach your earbuds.")
        val address = call.getString("address") ?: return call.reject("No earbuds given")
        val uuids = call.getArray("uuids")?.toList<String>() ?: return call.reject("No services given")
        val frames = call.getArray("frames")?.toList<String>() ?: return call.reject("No questions given")
        Thread {
            val device = adapter()?.getRemoteDevice(address)
            val answers = JSArray()
            for (u in uuids) {
                val heard = StringBuilder()
                try {
                    val s = connectSpp(device ?: throw IOException("Bluetooth is off"), UUID.fromString(u))
                    try {
                        for (f in frames) {
                            val bytes = f.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
                            s.outputStream.write(bytes); s.outputStream.flush()
                            val got = java.io.ByteArrayOutputStream()
                            val until = SystemClock.elapsedRealtime() + 700
                            while (SystemClock.elapsedRealtime() < until) {
                                val input = s.inputStream
                                if (input.available() > 0) { val buf = ByteArray(input.available()); got.write(buf, 0, input.read(buf)) } else Thread.sleep(15)
                            }
                            heard.append(" | ").append(f).append(" -> ").append(got.toByteArray().joinToString("") { "%02x".format(it) }.ifEmpty { "(nothing)" })
                        }
                    } finally { try { s.close() } catch (_: IOException) {} }
                } catch (e: Exception) {
                    heard.append(" | couldn't connect: ").append(e.message)
                }
                android.util.Log.i("BudsProbe", "${device?.name} $u$heard")
                answers.put(JSObject().put("uuid", u).put("heard", heard.toString()))
            }
            call.resolve(JSObject().put("answers", answers))
        }.apply { name = "buds-ask"; isDaemon = true }.start()
    }

    override fun handleOnDestroy() {
        stopNow()
        super.handleOnDestroy()
    }

    companion object {
        private const val SOM: Byte = 0xFD.toByte()
        private const val EOM: Byte = 0xDD.toByte()
        private const val SET_SPATIAL_AUDIO = 124
        private const val SPATIAL_AUDIO_DATA = 194
        private const val SPATIAL_AUDIO_CONTROL = 195
        private const val CTRL_ATTACH: Byte = 0
        private const val CTRL_DETACH: Byte = 1
        private const val CTRL_ATTACH_OK = 2
        private const val CTRL_DETACH_OK = 3
        private const val CTRL_KEEPALIVE: Byte = 4
        private const val DATA_GRV = 32
        private const val DATA_WEAR_ON = 33
        private const val DATA_WEAR_OFF = 34
        private const val DATA_STUCK = 36
        private const val NOISE_CONTROLS_UPDATE = 119

        /** CRC-16/XMODEM: poly 0x1021, init 0. */
        fun crc16(data: ByteArray): Int {
            var crc = 0
            for (b in data) {
                crc = crc xor ((b.toInt() and 0xFF) shl 8)
                repeat(8) { crc = if (crc and 0x8000 != 0) ((crc shl 1) xor 0x1021) and 0xFFFF else (crc shl 1) and 0xFFFF }
            }
            return crc
        }
    }
}
