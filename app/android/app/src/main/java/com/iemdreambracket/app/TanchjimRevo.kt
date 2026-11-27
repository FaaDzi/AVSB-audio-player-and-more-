package com.iemdreambracket.app

import android.bluetooth.BluetoothSocket
import android.os.SystemClock
import android.util.Log
import java.io.ByteArrayOutputStream
import java.util.UUID

/**
 * §115 A: Tanchjim Revo (Bluetrum chip, company id 0x0642) over its serial channel, the way the Tanchjim app talks to
 * it (RFCOMM channel 1, logcat 2026-11-27). Commands as described by dongleCTRL's "Bluetrum V2" notes (behaviour only,
 * our own code): TX `FF A1 <len> <cmd> <data> AA`, RX `FF A2 <len> <cmd> <data> AA`, len = 1 + data.
 * Game mode: read 07 / set 27 (0/1). Connection mode: read 08 / set 28 (0 standard, 1 LDAC, 2 two devices).
 * Battery: 02, left at [5], right at [7], case at [8].
 */
object TanchjimRevo {
    val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")
    const val GET_BATTERY = 0x02
    const val GET_GAME = 0x07
    const val GET_MODE = 0x08
    const val SET_GAME = 0x27
    const val SET_MODE = 0x28

    fun frame(cmd: Int, data: ByteArray = ByteArray(0)): ByteArray =
        byteArrayOf(0xFF.toByte(), 0xA1.toByte(), (1 + data.size).toByte(), cmd.toByte()) + data + 0xAA.toByte()

    /** Sends one command and returns its answer frame (`FF A2 … AA` for the same command), or null after `ms`. */
    fun ask(s: BluetoothSocket, cmd: Int, data: ByteArray = ByteArray(0), ms: Long = 600): ByteArray? {
        s.outputStream.write(frame(cmd, data)); s.outputStream.flush()
        val input = s.inputStream
        val got = ByteArrayOutputStream()
        val until = SystemClock.elapsedRealtime() + ms
        while (SystemClock.elapsedRealtime() < until) {
            if (input.available() > 0) {
                val buf = ByteArray(input.available()); got.write(buf, 0, input.read(buf))
                val answer = find(got.toByteArray(), cmd)
                if (answer != null) return answer
            } else Thread.sleep(15)
        }
        Log.i("BudsControl", "Revo: no answer to %02x; heard ".format(cmd) + got.toByteArray().joinToString(" ") { "%02x".format(it) })
        return null
    }

    fun find(bytes: ByteArray, cmd: Int): ByteArray? {
        var i = 0
        while (i + 4 < bytes.size) {
            if (bytes[i] == 0xFF.toByte() && bytes[i + 1] == 0xA2.toByte()) {
                val len = bytes[i + 2].toInt() and 0xFF
                val end = i + 3 + len
                if (end < bytes.size && bytes[end] == 0xAA.toByte() && (bytes[i + 3].toInt() and 0xFF) == cmd) return bytes.copyOfRange(i, end + 1)
            }
            i++
        }
        return null
    }
}
