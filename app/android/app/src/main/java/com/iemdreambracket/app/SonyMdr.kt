package com.iemdreambracket.app

import android.bluetooth.BluetoothSocket
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID

/**
 * §115 A / §117: Sony headphones' control channel ("MDR"). Behaviour and bytes from ncr/omarchy-headphones'
 * PROTOCOL.md (MIT): frame `3E type seq len32BE payload sum 3C`, 3C/3D/3E escaped as `3D (b and EF)`; type 0C =
 * command, 01 = ack (seq 1 - theirs); the first command asks the protocol version (`00 00`): a 4-byte answer is v1
 * (WH-1000XM4), 8 bytes v2 (XM5, XM6, CH720N). Noise: v1 block 02, v2 block 17; GET 66, RET 67, SET 68, NTFY 69.
 */
object SonyMdr {
    val V1: UUID = UUID.fromString("96cc203e-5068-46ad-b32d-e316f5e069ba")
    val V2: UUID = UUID.fromString("956c7b26-d49a-4ba8-b03f-b17d393cb6e2")

    fun frame(type: Int, seq: Int, payload: ByteArray): ByteArray {
        val body = ByteArrayOutputStream()
        body.write(type); body.write(seq)
        val n = payload.size
        body.write(n ushr 24); body.write(n ushr 16 and 0xFF); body.write(n ushr 8 and 0xFF); body.write(n and 0xFF)
        body.write(payload)
        val raw = body.toByteArray()
        val sum = raw.fold(0) { a, b -> a + (b.toInt() and 0xFF) } and 0xFF
        val out = ByteArrayOutputStream()
        out.write(0x3E)
        for (b in raw + sum.toByte()) {
            val v = b.toInt() and 0xFF
            if (v == 0x3C || v == 0x3D || v == 0x3E) { out.write(0x3D); out.write(v and 0xEF) } else out.write(v)
        }
        out.write(0x3C)
        return out.toByteArray()
    }

    /** Splits what arrived into unescaped frames: (type, seq, payload). */
    fun parse(bytes: ByteArray): List<Triple<Int, Int, ByteArray>> {
        val frames = mutableListOf<Triple<Int, Int, ByteArray>>()
        var i = 0
        while (i < bytes.size) {
            if (bytes[i].toInt() and 0xFF != 0x3E) { i++; continue }
            val end = (i + 1 until bytes.size).firstOrNull { bytes[it].toInt() and 0xFF == 0x3C } ?: break
            val raw = ByteArrayOutputStream()
            var j = i + 1
            while (j < end) {
                val v = bytes[j].toInt() and 0xFF
                if (v == 0x3D && j + 1 < end) { raw.write((bytes[j + 1].toInt() and 0xFF) or 0x10); j += 2 } else { raw.write(v); j++ }
            }
            val f = raw.toByteArray()
            if (f.size >= 7) frames.add(Triple(f[0].toInt() and 0xFF, f[1].toInt() and 0xFF, f.copyOfRange(6, f.size - 1)))
            i = end + 1
        }
        return frames
    }

    /** `mode` 0 off / 1 noise cancelling / 2 ambient; `level` 0-20 (ambient); `voice` Focus on Voice. */
    fun ncAsm(v2: Boolean, mode: Int, level: Int, voice: Boolean): ByteArray {
        val lv = level.coerceIn(0, 20).toByte()
        val vo: Byte = if (voice) 1 else 0
        return if (v2) when (mode) {
            0 -> byteArrayOf(0x68, 0x17, 1, 0, 0, vo, lv)
            1 -> byteArrayOf(0x68, 0x17, 1, 1, 0, vo, lv)
            else -> byteArrayOf(0x68, 0x17, 1, 1, 1, vo, lv)
        } else when (mode) {
            0 -> byteArrayOf(0x68, 0x02, 0x00, 0x01, 0x00, 0x01, vo, lv)
            1 -> byteArrayOf(0x68, 0x02, 0x11, 0x01, 0x02, 0x01, 0x00, 0x00)
            else -> byteArrayOf(0x68, 0x02, 0x11, 0x01, 0x00, 0x01, vo, lv)
        }
    }

    /** A RET (67) or NTFY (69) noise block as {mode, level, voice}, or null when it isn't one. */
    fun noiseOf(p: ByteArray): Triple<Int, Int, Boolean>? {
        if (p.size < 2 || (p[0].toInt() and 0xFF) !in listOf(0x67, 0x69)) return null
        val u = { i: Int -> p[i].toInt() and 0xFF }
        return when (u(1)) {
            // v1: type, effect, ncType, ncValue, asmType, asmId, asmValue
            0x02 -> if (p.size < 8) null else if (u(2) == 0) Triple(0, u(7), u(6) == 1)
                else if (u(4) == 0x00) Triple(2, u(7), u(6) == 1) else Triple(1, u(7), u(6) == 1)
            // v2: block, change status, effect, mode, voice, level
            0x17 -> if (p.size < 7) null else if (u(3) == 0) Triple(0, u(6), u(5) == 1)
                else Triple(if (u(4) == 1) 2 else 1, u(6), u(5) == 1)
            else -> null
        }
    }

    /** One connection: the handshake, then questions and settings, every frame from the headphones acked. */
    class Session(private val s: BluetoothSocket, v2Hint: Boolean, private val log: StringBuilder) {
        var v2 = v2Hint
            private set
        private var seq = 0
        private val heard = mutableListOf<ByteArray>()

        private fun pump(ms: Long, until: (ByteArray) -> Boolean): ByteArray? {
            val input = s.inputStream
            val got = ByteArrayOutputStream()
            val end = SystemClock.elapsedRealtime() + ms
            var done = 0
            while (SystemClock.elapsedRealtime() < end) {
                if (input.available() > 0) {
                    val buf = ByteArray(input.available()); got.write(buf, 0, input.read(buf))
                    val frames = parse(got.toByteArray())
                    for (k in done until frames.size) {
                        val (type, fseq, payload) = frames[k]
                        log.append(" [%02x ".format(type)).append(payload.joinToString(" ") { "%02x".format(it) }).append(']')
                        if (type == 0x0C || type == 0x0E) { s.outputStream.write(frame(0x01, 1 - fseq, ByteArray(0))); s.outputStream.flush(); heard.add(payload) }
                    }
                    done = frames.size
                    heard.firstOrNull(until)?.let { heard.remove(it); return it }
                } else Thread.sleep(15)
            }
            return null
        }

        fun send(payload: ByteArray, ms: Long, until: (ByteArray) -> Boolean): ByteArray? {
            s.outputStream.write(frame(0x0C, seq, payload)); s.outputStream.flush()
            seq = 1 - seq
            return pump(ms, until)
        }

        fun handshake() {
            repeat(3) {
                val info = send(byteArrayOf(0, 0), 600) { it.isNotEmpty() && it[0].toInt() == 0x01 }
                if (info != null) { v2 = info.size >= 8; return }
            }
            throw IOException("The headphones didn't answer")
        }

        fun readNoise(): Triple<Int, Int, Boolean>? =
            send(byteArrayOf(0x66, if (v2) 0x17 else 0x02), 900) { noiseOf(it) != null }?.let { noiseOf(it) }

        /** v1 single battery (`10 00` → `11 00 level charging`); v2 isn't asked (its layout isn't known here). */
        fun readBattery(): Int? =
            if (v2) null else send(byteArrayOf(0x10, 0x00), 700) { it.size >= 3 && it[0].toInt() == 0x11 }?.let { it[2].toInt() and 0xFF }

        /**
         * §119: "Prioritize sound quality" (0, LDAC allowed) or "stable connection" (1). AUDIO block: GET e6 sub, RET e7
         * sub mode, SET e8 sub mode; sub 02 on LDAC models, 00 otherwise (SonyBridge PR #6, from SonyHeadphonesClient's
         * libmdr). Returns (sub, mode), or null when neither sub answers.
         */
        fun readQuality(): Pair<Int, Int>? {
            for (subType in intArrayOf(0x02, 0x00)) {
                val r = send(byteArrayOf(0xE6.toByte(), subType.toByte()), 700) { it.size >= 3 && (it[0].toInt() and 0xFF) == 0xE7 && (it[1].toInt() and 0xFF) == subType }
                // the LDAC variant (sub 02) carries one more byte before the mode (`e7 02 00 01` on the XM4 while the
                // phone is on AAC with LDAC off = stable connection); the plain one has the mode right after the sub
                if (r != null) return subType to (r[if (r.size >= 4) 3 else 2].toInt() and 0xFF)
            }
            return null
        }

        fun setQuality(subType: Int, mode: Int): Int? {
            val body = if (subType == 0x02) byteArrayOf(0xE8.toByte(), 0x02, 0x00, mode.toByte()) else byteArrayOf(0xE8.toByte(), subType.toByte(), mode.toByte())
            val r = send(body, 1500) { it.size >= 3 && (it[0].toInt() and 0xFF) in listOf(0xE7, 0xE9) && (it[1].toInt() and 0xFF) == subType }
            return r?.let { it[if (it.size >= 4) 3 else 2].toInt() and 0xFF } ?: readQuality()?.second
        }

        /** Sets the noise block; the headphones' own notification is the answer (null: not confirmed). */
        fun setNoise(mode: Int, level: Int, voice: Boolean): Triple<Int, Int, Boolean>? =
            send(ncAsm(v2, mode, level, voice), 1500) { it.size >= 2 && (it[0].toInt() and 0xFF) == 0x69 && noiseOf(it) != null }?.let { noiseOf(it) }
    }
}
