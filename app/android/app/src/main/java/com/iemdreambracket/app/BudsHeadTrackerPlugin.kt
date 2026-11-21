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
            if (service in uuids) list.put(JSObject().put("name", d.name ?: "Galaxy Buds").put("address", d.address))
        }
        call.resolve(JSObject().put("devices", list))
    }

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
                val s = device.createRfcommSocketToServiceRecord(service)
                s.connect()
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
        if (id == SPATIAL_AUDIO_CONTROL && payload.isNotEmpty()) {
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
