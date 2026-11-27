package com.iemdreambracket.app

import android.bluetooth.BluetoothSocket
import android.os.SystemClock
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID

/**
 * §117: universal wireless control. One driver per protocol, all with the same jobs: recognise a pair (its name and
 * its own service UUID, never a generic serial port alone), read its state, change one setting and return what the
 * pair itself confirms. The page (TypeScript) owns the capability table and the UI; this side only speaks protocols.
 * State is JSON: battery {left,right,case,single}, noise {mode 0 off / 1 cancelling / 2 ambient, level, voice},
 * game 0/1, connection 0 standard / 1 LDAC / 2 two devices, info {model, firmware, features}.
 */
interface WirelessDriver {
    val id: String
    val uuid: UUID
    fun read(s: BluetoothSocket, log: StringBuilder): JSObject
    /** Returns the confirmed part of the state; throws when the pair didn't confirm. */
    fun set(s: BluetoothSocket, key: String, value: Int, level: Int?, voice: Boolean?, log: StringBuilder): JSObject
}

private fun hex(b: ByteArray) = b.joinToString(" ") { "%02x".format(it) }

/** Reads whatever arrives for up to `ms`, stopping early once `done` says the bytes so far are enough. */
private fun listen(s: BluetoothSocket, ms: Long, done: (ByteArray) -> Boolean = { false }): ByteArray {
    val input = s.inputStream
    val got = ByteArrayOutputStream()
    val end = SystemClock.elapsedRealtime() + ms
    while (SystemClock.elapsedRealtime() < end) {
        if (input.available() > 0) {
            val buf = ByteArray(input.available()); got.write(buf, 0, input.read(buf))
            if (done(got.toByteArray())) break
        } else Thread.sleep(15)
    }
    return got.toByteArray()
}

private class NotConfirmed(what: String) : IOException("$what wasn't confirmed by the earbuds")

/** Galaxy Buds+ … Buds3 (Samsung's newer management service). Frames as Galaxy Wearable sends them (its own log). */
object SamsungDriver : WirelessDriver {
    override val id = "samsung"
    override val uuid: UUID = UUID.fromString("2e73a4ad-332d-41fc-90e2-16bef06523f2")
    private const val ACK = 0x42
    private const val EXTENDED_STATUS = 0x61
    private const val MANAGER_INFO = 0x88
    private val ids = mapOf("noise" to 0x78, "ambient" to 0x84, "game" to 0x87)

    fun frame(id: Int, payload: ByteArray): ByteArray {
        val body = byteArrayOf(id.toByte()) + payload
        val size = body.size + 2
        val crc = BudsHeadTrackerPlugin.crc16(body)
        return byteArrayOf(0xFD.toByte(), (size and 0xFF).toByte(), (size shr 8).toByte()) + body +
            byteArrayOf((crc and 0xFF).toByte(), (crc shr 8).toByte(), 0xDD.toByte())
    }

    /** (id, payload) of each whole frame in `b`. */
    fun frames(b: ByteArray): List<Pair<Int, ByteArray>> {
        val out = mutableListOf<Pair<Int, ByteArray>>()
        var i = 0
        while (i + 4 < b.size) {
            if (b[i] != 0xFD.toByte()) { i++; continue }
            val size = ((b[i + 1].toInt() and 0xFF) or ((b[i + 2].toInt() and 0xFF) shl 8)) and 0x3FF
            val end = i + 3 + size
            if (size < 3 || end >= b.size || b[end] != 0xDD.toByte()) { i++; continue }
            out.add((b[i + 3].toInt() and 0xFF) to b.copyOfRange(i + 4, end - 2))
            i = end + 1
        }
        return out
    }

    private fun hello(s: BluetoothSocket) {
        s.outputStream.write(frame(MANAGER_INFO, byteArrayOf(1, 1, android.os.Build.VERSION.SDK_INT.coerceAtMost(127).toByte())))
        s.outputStream.flush()
    }

    override fun read(s: BluetoothSocket, log: StringBuilder): JSObject {
        hello(s)
        val got = listen(s, 1200) { b -> frames(b).any { it.first == EXTENDED_STATUS } }
        log.append(" samsung read: ").append(hex(got))
        val st = frames(got).firstOrNull { it.first == EXTENDED_STATUS }?.second ?: return JSObject()
        val u = { i: Int -> if (i < st.size) st[i].toInt() and 0xFF else -1 }
        val out = JSObject()
        // battery left/right at 2 and 3, the case at 7 (GalaxyBudsClient's decoder); the case reads 0 until its lid
        // has been opened with the buds in it, so 0 means "not reported", not empty
        if (u(2) in 0..100 && u(3) in 0..100) out.put("battery", JSObject().put("left", u(2)).put("right", u(3)).apply { if (u(7) in 1..100) put("case", u(7)) })
        // the noise mode at 12 is confirmed on the Buds2 only (two captures, 2026-11-27)
        // placement, high nibble left, low right: 1 worn, 2 out, 3 in the case (GalaxyBudsClient); noise control only
        // switches while a bud is worn
        if (u(6) >= 0) out.put("worn", (u(6) shr 4) == 1 || (u(6) and 0x0F) == 1)
        out.put("rawStatus", hex(st))
        if (u(12) in 0..3) out.put("noiseAt12", u(12))
        return out
    }

    override fun set(s: BluetoothSocket, key: String, value: Int, level: Int?, voice: Boolean?, log: StringBuilder): JSObject {
        val id = ids[key] ?: throw IOException("Not a setting these buds take")
        hello(s)
        Thread.sleep(150)
        s.outputStream.write(frame(id, byteArrayOf(value.toByte()))); s.outputStream.flush()
        val got = listen(s, 1200) { b -> frames(b).any { it.first == ACK && it.second.size >= 2 && (it.second[0].toInt() and 0xFF) == id } }
        log.append(" samsung set $key=$value: ").append(hex(got))
        val ack = frames(got).firstOrNull { it.first == ACK && it.second.size >= 2 && (it.second[0].toInt() and 0xFF) == id }
            ?: throw NotConfirmed(key)
        val confirmed = ack.second[1].toInt() and 0xFF
        return when (key) {
            "noise" -> JSObject().put("noise", JSObject().put("mode", if (confirmed == 2) 2 else confirmed))
            "ambient" -> JSObject().put("noise", JSObject().put("mode", 2).put("level", confirmed))
            else -> JSObject().put("game", confirmed)
        }
    }
}

/** Sony MDR v1 (WH-1000XM4) and v2 (XM5, XM6, CH720N). */
class SonyDriver(private val v2: Boolean) : WirelessDriver {
    override val id = if (v2) "sony-v2" else "sony"
    override val uuid: UUID = if (v2) SonyMdr.V2 else SonyMdr.V1

    private fun noise(n: Triple<Int, Int, Boolean>) = JSObject().put("mode", n.first).put("level", n.second).put("voice", n.third)

    override fun read(s: BluetoothSocket, log: StringBuilder): JSObject {
        val session = SonyMdr.Session(s, v2, log)
        session.handshake()
        val out = JSObject()
        session.readNoise()?.let { out.put("noise", noise(it)) }
        session.readBattery()?.let { out.put("battery", JSObject().put("single", it)) }
        session.readQuality()?.let { out.put("quality", it.second) }
        return out
    }

    override fun set(s: BluetoothSocket, key: String, value: Int, level: Int?, voice: Boolean?, log: StringBuilder): JSObject {
        val session = SonyMdr.Session(s, v2, log)
        if (key == "quality") {
            if (value !in 0..1) throw IOException("Not a setting these headphones take")
            session.handshake()
            val (subType, _) = session.readQuality() ?: throw IOException("These headphones have no sound quality setting")
            val now = session.setQuality(subType, value)
            if (now != value) throw NotConfirmed("Sound quality")
            return JSObject().put("quality", now)
        }
        if (key != "noise" || value !in 0..2) throw IOException("Not a setting these headphones take")
        session.handshake()
        val confirmed = session.setNoise(value, level ?: 10, voice ?: false) ?: throw NotConfirmed("Noise control")
        return JSObject().put("noise", noise(confirmed))
    }
}

/** Tanchjim Revo (Bluetrum): see TanchjimRevo.kt. */
object RevoDriver : WirelessDriver {
    override val id = "tanchjim-revo"
    override val uuid: UUID = TanchjimRevo.SPP

    override fun read(s: BluetoothSocket, log: StringBuilder): JSObject {
        val out = JSObject()
        val bat = TanchjimRevo.ask(s, TanchjimRevo.GET_BATTERY)
        if (bat != null && bat.size >= 10) out.put("battery", JSObject().put("left", bat[5].toInt() and 0xFF).put("right", bat[7].toInt() and 0xFF).put("case", bat[8].toInt() and 0xFF))
        TanchjimRevo.ask(s, TanchjimRevo.GET_GAME)?.takeIf { it.size >= 6 }?.let { out.put("game", it[4].toInt() and 0xFF) }
        TanchjimRevo.ask(s, TanchjimRevo.GET_MODE)?.takeIf { it.size >= 6 }?.let { out.put("connection", it[4].toInt() and 0xFF) }
        log.append(" revo read: ").append(out.toString())
        return out
    }

    override fun set(s: BluetoothSocket, key: String, value: Int, level: Int?, voice: Boolean?, log: StringBuilder): JSObject {
        val (setCmd, getCmd, range) = when (key) {
            "game" -> Triple(TanchjimRevo.SET_GAME, TanchjimRevo.GET_GAME, 0..1)
            "connection" -> Triple(TanchjimRevo.SET_MODE, TanchjimRevo.GET_MODE, 0..2)
            else -> throw IOException("Not a setting these earbuds take")
        }
        if (value !in range) throw IOException("Not a setting these earbuds take")
        TanchjimRevo.ask(s, setCmd, byteArrayOf(value.toByte()))
        val now = TanchjimRevo.ask(s, getCmd)?.takeIf { it.size >= 6 }?.let { it[4].toInt() and 0xFF }
        log.append(" revo set $key=$value -> $now")
        if (now != value) throw NotConfirmed(key)
        return JSObject().put(key, now)
    }
}

/** Qualcomm GAIA v3 (most chi-fi on QCC chips): read-only identity and feature list. Never reset (6), never upgrade. */
object GaiaDriver : WirelessDriver {
    override val id = "gaia"
    override val uuid: UUID = TanchjimRevo.SPP

    private fun ask(s: BluetoothSocket, cmd: Int): ByteArray? {
        s.outputStream.write(byteArrayOf(0xFF.toByte(), 0x03, 0, 0, 0, 0x1D, 0, cmd.toByte())); s.outputStream.flush()
        val got = listen(s, 700) { it.size >= 8 && it.size >= 8 + (it[3].toInt() and 0xFF) }
        // answer: FF 03 00 <len> 00 1D 01 <cmd> <payload>
        if (got.size < 8 || got[0] != 0xFF.toByte() || (got[6].toInt() and 0xFF) != 0x01 || (got[7].toInt() and 0xFF) != cmd) return null
        return got.copyOfRange(8, (8 + (got[3].toInt() and 0xFF)).coerceAtMost(got.size))
    }

    override fun read(s: BluetoothSocket, log: StringBuilder): JSObject {
        val info = JSObject()
        ask(s, 0x04)?.let { info.put("model", String(it, Charsets.UTF_8)) }
        ask(s, 0x05)?.let { info.put("firmware", String(it, Charsets.UTF_8)) }
        ask(s, 0x01)?.let { f ->
            val list = JSArray()
            var i = 1
            while (i + 1 < f.size) { list.put(f[i].toInt() and 0xFF); i += 2 }
            info.put("features", list)
        }
        info.put("chip", "Qualcomm")
        log.append(" gaia read: ").append(info.toString())
        return JSObject().put("info", info)
    }

    override fun set(s: BluetoothSocket, key: String, value: Int, level: Int?, voice: Boolean?, log: StringBuilder): JSObject =
        throw IOException("These earbuds are controlled from their own buttons")
}

/**
 * Google Fast Pair message stream (many brands): the pair sends its battery on connect, group 03 code 03, one byte per
 * battery (L, R, case; high bit = charging, 7F = unknown). Untested: none of the owner's pairs offer it.
 */
object FastPairBattery {
    val UUID_STREAM: UUID = UUID.fromString("df21fe2c-2515-4fdb-8886-f12c4d67927c")

    fun read(s: BluetoothSocket, log: StringBuilder): JSObject? {
        val got = listen(s, 1500)
        log.append(" fastpair: ").append(hex(got))
        var i = 0
        while (i + 4 <= got.size) {
            val len = ((got[i + 2].toInt() and 0xFF) shl 8) or (got[i + 3].toInt() and 0xFF)
            if (got[i].toInt() == 0x03 && got[i + 1].toInt() == 0x03 && i + 4 + len <= got.size) {
                val pct = { k: Int -> (got[i + 4 + k].toInt() and 0x7F).takeIf { it <= 100 } }
                return if (len == 1) JSObject().put("single", pct(0)) else JSObject().put("left", pct(0)).put("right", pct(1)).apply { if (len >= 3) put("case", pct(2)) }
            }
            i += 4 + len
        }
        return null
    }
}

/**
 * Soundcore Sleep A30 (model D1301). Behaviour from OpenSCQ30's D1301 notes (GPL: read for behaviour, our own code):
 * TX `08 ee 00 00 00 <cmd 2> <len u16 LE, whole frame> <data> <sum>`, RX `09 ff 00 00 01 …`. State: ask `01 01`;
 * battery L/R at 2/3 (0-9 = 10-100 %), listening mode at 65 (0 Bluetooth, 1 Local), noise cancelling at 140.
 * Noise cancelling is set with `06 87` + 0/1, confirmed by asking the state again.
 */
object SoundcoreD1301 : WirelessDriver {
    override val id = "soundcore-d1301"
    override val uuid: UUID = UUID.fromString("0cf12d31-fac3-4553-bd80-d6832e7d1301")

    fun frame(c0: Int, c1: Int, data: ByteArray = ByteArray(0)): ByteArray {
        val len = 10 + data.size
        val head = byteArrayOf(0x08, 0xEE.toByte(), 0, 0, 0, c0.toByte(), c1.toByte(), (len and 0xFF).toByte(), (len shr 8).toByte()) + data
        return head + (head.fold(0) { a, b -> a + (b.toInt() and 0xFF) } and 0xFF).toByte()
    }

    /** The answer to `c0 c1`: its data, or null. */
    private fun answer(b: ByteArray, c0: Int, c1: Int): ByteArray? {
        var i = 0
        while (i + 9 <= b.size) {
            if (b[i] == 0x09.toByte() && b[i + 1] == 0xFF.toByte() && (b[i + 5].toInt() and 0xFF) == c0 && (b[i + 6].toInt() and 0xFF) == c1) {
                val len = (b[i + 7].toInt() and 0xFF) or ((b[i + 8].toInt() and 0xFF) shl 8)
                if (i + len <= b.size && len >= 10) return b.copyOfRange(i + 9, i + len - 1)
            }
            i++
        }
        return null
    }

    private fun state(s: BluetoothSocket, log: StringBuilder): ByteArray? {
        s.outputStream.write(frame(0x01, 0x01)); s.outputStream.flush()
        val got = listen(s, 1500) { answer(it, 0x01, 0x01) != null }
        log.append(" d1301 state: ").append(hex(got))
        return answer(got, 0x01, 0x01)
    }

    override fun read(s: BluetoothSocket, log: StringBuilder): JSObject {
        val st = state(s, log) ?: return JSObject()
        val u = { i: Int -> if (i < st.size) st[i].toInt() and 0xFF else -1 }
        val out = JSObject()
        val pct = { v: Int -> ((v + 1) * 10).coerceAtMost(100) }
        if (u(2) in 0..9 && u(3) in 0..9) out.put("battery", JSObject().put("left", pct(u(2))).put("right", pct(u(3))))
        if (u(140) in 0..1) out.put("noise", JSObject().put("mode", u(140)))
        if (u(65) in 0..1) out.put("listening", u(65))
        return out
    }

    override fun set(s: BluetoothSocket, key: String, value: Int, level: Int?, voice: Boolean?, log: StringBuilder): JSObject {
        if (key != "noise" || value !in 0..1) throw IOException("These earbuds only switch noise cancelling on or off")
        s.outputStream.write(frame(0x06, 0x87, byteArrayOf(value.toByte()))); s.outputStream.flush()
        listen(s, 400)
        val now = state(s, log)?.let { if (it.size > 140) it[140].toInt() and 0xFF else null }
        log.append(" d1301 set noise=$value -> $now")
        if (now != value) throw NotConfirmed("Noise cancelling")
        return JSObject().put("noise", JSObject().put("mode", now))
    }
}

object Wireless {
    /** The driver for a pair, from its name and service UUIDs; null when we don't speak its protocol. */
    fun driverFor(name: String, uuids: List<UUID>): WirelessDriver? = when {
        SamsungDriver.uuid in uuids -> SamsungDriver
        SonyMdr.V2 in uuids -> SonyDriver(true)
        SonyMdr.V1 in uuids -> SonyDriver(false)
        SoundcoreD1301.uuid in uuids -> SoundcoreD1301
        TanchjimRevo.SPP in uuids && name.contains("TANCHJIM-REVO", ignoreCase = true) -> RevoDriver
        // GAIA isn't claimed from the serial port alone: the pair also has to show Qualcomm's own service family
        TanchjimRevo.SPP in uuids && uuids.any { it.toString().endsWith("-d102-11e1-9b23-00025b00a5a5") } -> GaiaDriver
        else -> null
    }

    /** Drivers confirmed on real hardware (§117: the rest are shown as untested). */
    val TESTED = setOf("samsung", "sony", "tanchjim-revo", "gaia", "soundcore-d1301")
}
