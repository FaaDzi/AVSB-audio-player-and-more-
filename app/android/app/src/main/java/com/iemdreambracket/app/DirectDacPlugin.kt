package com.iemdreambracket.app

import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioMixerAttributes
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Direct to DAC (plan §77): a native player for when a USB DAC is plugged in and nothing in the app changes the sound.
 * Decodes the file at its own rate and bit depth and asks Android for a USB mixer at exactly that format
 * (setPreferredMixerAttributes, API 34; needs MODIFY_AUDIO_SETTINGS), so the DAC gets the song's own rate with no
 * resampling. The Xiaomi 14 offers no bit-perfect mixer for USB (Phase 0), so Android's media volume still applies;
 * the only thing the app adds is a gain (its volume slider and levelling) on the track.
 *
 * Plays songs on the phone (content URIs from the media index) and PC songs saved offline. Gapless when the next song
 * has the same format; a new format re-opens the output (a short gap, unavoidable). The web player keeps the media
 * session; this only plays. Events: "state" {position, duration, playing}, "nearEnd", "advance" {path, ...format},
 * "ended", "unplugged" {position}, "error" {message}.
 */
@CapacitorPlugin(name = "DirectDac")
class DirectDacPlugin : Plugin() {
    private lateinit var am: AudioManager
    private val attrs: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()
    @Volatile private var player: Player? = null
    /** The device's L/R correction (§78 E): + makes the right side louder. Only ever turns one side down. */
    @Volatile private var balanceDb = 0.0
    /** Left and right swapped (§78 E1): a reversed cable or mislabelled earpieces. Sample values stay untouched. */
    @Volatile private var swapLR = false

    @Suppress("DEPRECATION")
    private fun applyGain(t: AudioTrack?, gain: Double) {
        val g = gain.coerceIn(0.0, 1.0)
        val left = g * minOf(1.0, Math.pow(10.0, -balanceDb / 20))
        val right = g * minOf(1.0, Math.pow(10.0, balanceDb / 20))
        runCatching { t?.setStereoVolume(left.toFloat(), right.toFloat()) }
    }

    private val devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
            val p = player ?: return
            if (removed.none { it.id == p.dac.id }) return
            // pause before Android reroutes the track to the speaker; the web player takes over (speaker guard and all)
            p.pause()
            notifyListeners("unplugged", JSObject().put("position", p.position()))
            stopPlayer()
        }
    }

    override fun load() {
        am = context.getSystemService(AudioManager::class.java)
        am.registerAudioDeviceCallback(devices, Handler(Looper.getMainLooper()))
    }

    override fun handleOnDestroy() {
        am.unregisterAudioDeviceCallback(devices)
        stopPlayer()
    }

    private fun usbDac(): AudioDeviceInfo? = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull {
        it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_DEVICE
    }

    private fun mixers(dac: AudioDeviceInfo): List<AudioMixerAttributes> =
        if (Build.VERSION.SDK_INT >= 34) runCatching { am.getSupportedMixerAttributes(dac) }.getOrDefault(emptyList()) else emptyList()

    /** Is there a USB DAC this can play to, and at which rates. */
    @PluginMethod
    fun support(call: PluginCall) {
        val dac = usbDac()
        val list = dac?.let { mixers(it) } ?: emptyList()
        val rates = JSArray()
        list.map { it.format.sampleRate }.distinct().sorted().forEach { rates.put(it) }
        call.resolve(JSObject().put("available", dac != null && list.isNotEmpty()).put("name", dac?.productName?.toString() ?: "").put("rates", rates))
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("no path")
        val dac = usbDac() ?: return call.reject("no-dac")
        if (mixers(dac).isEmpty()) return call.reject("no-dac")
        stopPlayer()
        balanceDb = call.getDouble("balanceDb") ?: 0.0
        swapLR = call.getBoolean("swap") ?: false
        val src = try { open(path, call.getDouble("gain") ?: 1.0) } catch (e: Exception) {
            return call.reject("unavailable", e.message)
        }
        val p = Player(dac, src, call.getDouble("startAt") ?: 0.0, call.getBoolean("autostart") ?: true)
        try { p.openTrack(src) } catch (e: Exception) {
            src.release()
            return call.reject("unavailable", e.message)
        }
        player = p
        p.start()
        call.resolve(p.info(src))
    }

    @PluginMethod
    fun queueNext(call: PluginCall) {
        val p = player ?: return call.reject("not playing")
        val path = call.getString("path") ?: return call.reject("no path")
        try {
            p.queue(open(path, call.getDouble("gain") ?: 1.0))
            call.resolve()
        } catch (e: Exception) {
            call.reject("unavailable", e.message)
        }
    }

    @PluginMethod fun clearNext(call: PluginCall) { player?.queue(null); call.resolve() }
    @PluginMethod fun pause(call: PluginCall) { player?.pause(); call.resolve() }
    @PluginMethod fun resume(call: PluginCall) { player?.unpause(); call.resolve() }
    @PluginMethod fun seek(call: PluginCall) { player?.seek(call.getDouble("seconds") ?: 0.0); call.resolve() }
    @PluginMethod fun setGain(call: PluginCall) { player?.setGain(call.getDouble("gain") ?: 1.0); call.resolve() }
    @PluginMethod fun setChannels(call: PluginCall) {
        balanceDb = call.getDouble("balanceDb") ?: 0.0
        swapLR = call.getBoolean("swap") ?: false
        player?.reapplyGain()
        call.resolve()
    }
    @PluginMethod fun stop(call: PluginCall) { stopPlayer(); call.resolve() }
    @PluginMethod fun position(call: PluginCall) { call.resolve(player?.state() ?: JSObject().put("position", 0).put("duration", 0).put("playing", false)) }

    private fun stopPlayer() {
        val p = player ?: return
        player = null
        p.quit()
    }

    /**
     * A song on the phone (from the media index), a PC song saved offline, or a PC song streamed now: that one is
     * read into memory as it arrives (no flash, like the link's own cache) and decoding starts on the first bytes.
     */
    private fun open(path: String, gain: Double): Source {
        val ex = MediaExtractor()
        var stream: StreamedSong? = null
        try {
            if (path.startsWith("pc:")) {
                val id = path.substring(3)
                val link = LinkPlugin.instance ?: throw IllegalStateException("no PC link")
                val f = link.songFile(id)
                if (f != null) ex.setDataSource(f.absolutePath)
                else {
                    val r = link.openSongStream(id, false, null) ?: throw IllegalStateException("PC song not reachable")
                    if (r.contentLength <= 0 || r.contentLength > MAX_STREAMED_BYTES) {
                        r.stream.close()
                        throw IllegalStateException("PC song size ${r.contentLength}")
                    }
                    stream = try { StreamedSong(r.stream, r.contentLength) } catch (e: OutOfMemoryError) {
                        r.stream.close()
                        throw IllegalStateException("no memory for a ${r.contentLength} B song")
                    }
                    ex.setDataSource(stream)
                }
            } else {
                val uri: Uri = ShellHostPlugin.get()?.indexedUri(path) ?: throw IllegalStateException("not in the library")
                ex.setDataSource(context, uri, null)
            }
            return Source(path, ex, gain, stream)
        } catch (e: Exception) {
            ex.release()
            stream?.close()
            throw e
        }
    }

    /** A PC song arriving over the link, held in memory; reads wait for the bytes they need. */
    private class StreamedSong(private val input: java.io.InputStream, private val size: Long) : android.media.MediaDataSource() {
        private val bytes = ByteArray(size.toInt())
        private val lock = Object()
        private var have = 0
        @Volatile private var closed = false
        private var failed: Exception? = null

        init {
            Thread({
                try {
                    while (!closed && have < bytes.size) {
                        val n = input.read(bytes, have, minOf(65536, bytes.size - have))
                        if (n < 0) break
                        synchronized(lock) { have += n; lock.notifyAll() }
                    }
                } catch (e: Exception) {
                    synchronized(lock) { failed = e; lock.notifyAll() }
                } finally {
                    runCatching { input.close() }
                    synchronized(lock) { if (have < bytes.size && failed == null && !closed) failed = java.io.EOFException("stream ended early"); lock.notifyAll() }
                }
            }, "DirectDac-stream").start()
        }

        override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
            if (position >= bytes.size) return -1
            val end = minOf(bytes.size.toLong(), position + size).toInt()
            synchronized(lock) {
                while (have < end && failed == null && !closed) lock.wait(500)
                if (closed) return -1
                if (have < end) failed?.let { throw java.io.IOException(it) }
            }
            val n = end - position.toInt()
            System.arraycopy(bytes, position.toInt(), buffer, offset, n)
            return n
        }

        override fun getSize() = size

        override fun close() {
            synchronized(lock) { closed = true; lock.notifyAll() }
        }
    }

    /** One song's decoder. The first PCM is decoded up front so the output format is known before the track opens. */
    private class Source(val path: String, private val ex: MediaExtractor, @Volatile var gain: Double, private val stream: StreamedSong? = null) {
        private val codec: MediaCodec
        private val info = MediaCodec.BufferInfo()
        private var inputDone = false
        private var outputDone = false
        private var pending: ByteArray? = null
        private var pendingPts = 0L
        val mime: String
        val durationUs: Long
        /** The file's own bit depth (0 = not stated). */
        val bits: Int
        var rate = 0; private set
        var channels = 0; private set
        var encoding = AudioFormat.ENCODING_PCM_16BIT; private set
        var lastPtsUs = 0L; private set

        init {
            val index = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: throw IllegalStateException("no audio")
            ex.selectTrack(index)
            val f = ex.getTrackFormat(index)
            mime = f.getString(MediaFormat.KEY_MIME)!!
            durationUs = if (f.containsKey(MediaFormat.KEY_DURATION)) f.getLong(MediaFormat.KEY_DURATION) else 0L
            bits = when {
                f.containsKey("bits-per-sample") -> f.getInteger("bits-per-sample")
                f.containsKey(MediaFormat.KEY_PCM_ENCODING) -> bitsOf(f.getInteger(MediaFormat.KEY_PCM_ENCODING))
                else -> 0
            }
            if (f.getInteger(MediaFormat.KEY_CHANNEL_COUNT) > 2) throw IllegalStateException("more than two channels")
            // 16-bit files decode to 16-bit (exact); anything deeper, or not stated, to float (exact up to 24-bit)
            if (bits != 16) f.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_FLOAT)
            codec = MediaCodec.createDecoderByType(mime)
            try {
                codec.configure(f, null, null, 0)
                codec.start()
                readFormat(codec.outputFormat)
                pending = decode()
                pendingPts = lastPtsUs
            } catch (e: Exception) {
                codec.release()
                throw e
            }
            if (rate <= 0 || channels !in 1..2) throw IllegalStateException("unsupported format")
        }

        private fun readFormat(f: MediaFormat) {
            if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            encoding = if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) f.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
        }

        val frameBytes get() = channels * when (encoding) {
            AudioFormat.ENCODING_PCM_FLOAT, AudioFormat.ENCODING_PCM_32BIT -> 4
            AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3
            AudioFormat.ENCODING_PCM_8BIT -> 1
            else -> 2
        }

        /** The next block of PCM, or null at the end. */
        fun next(): ByteArray? {
            pending?.let { pending = null; lastPtsUs = pendingPts; return it }
            return decode()
        }

        private fun decode(): ByteArray? {
            while (!outputDone) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(5_000)
                    if (i >= 0) {
                        val n = ex.readSampleData(codec.getInputBuffer(i)!!, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0)
                            ex.advance()
                        }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 5_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) readFormat(codec.outputFormat)
                if (o < 0) continue
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                val out = codec.getOutputBuffer(o)!!
                val bytes = ByteArray(info.size)
                out.position(info.offset)
                out.get(bytes)
                lastPtsUs = info.presentationTimeUs
                codec.releaseOutputBuffer(o, false)
                if (bytes.isNotEmpty()) return bytes
            }
            return null
        }

        fun seek(us: Long) {
            ex.seekTo(us, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            codec.flush()
            pending = null
            inputDone = false
            outputDone = false
        }

        fun release() {
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { ex.release() }
            stream?.close()
        }

        companion object {
            fun bitsOf(enc: Int) = when (enc) {
                AudioFormat.ENCODING_PCM_16BIT -> 16
                AudioFormat.ENCODING_PCM_24BIT_PACKED -> 24
                AudioFormat.ENCODING_PCM_32BIT, AudioFormat.ENCODING_PCM_FLOAT -> 32
                else -> 0
            }
        }
    }

    /** Where in the track's frames a song starts, and the song position at that frame (a seek moves it). */
    private class Segment(val startFrame: Long, val offsetSec: Double, val src: Source)

    private inner class Player(val dac: AudioDeviceInfo, private var cur: Source, startAt: Double, autostart: Boolean) : Thread("DirectDac") {
        private val lock = Object()
        @Volatile private var paused = !autostart
        @Volatile private var quitting = false
        private var seekTo: Double? = if (startAt > 0) startAt else null
        private var next: Source? = null
        private var track: AudioTrack? = null
        private var trackKey = ""
        private var written = 0L
        private var headRaw = 0L
        private var headWraps = 0L
        private val segments = ArrayDeque<Segment>().apply { add(Segment(0, 0.0, cur)) }
        private var nearEndSent = false
        private var lastState = 0L
        private var mixerRate = 0
        private var mixerBits = 0

        fun info(src: Source) = JSObject()
            .put("path", src.path).put("rate", src.rate).put("bits", src.bits).put("channels", src.channels)
            .put("mime", src.mime).put("duration", src.durationUs / 1e6)
            .put("dacRate", mixerRate).put("dacBits", mixerBits)

        /** Opens the output at the song's own format. Re-applies the preferred mixer each time the format changes. */
        fun openTrack(src: Source) {
            track?.let { runCatching { it.stop() }; it.release() }
            track = null
            if (Build.VERSION.SDK_INT >= 34) {
                val want = when { src.bits in 1..16 -> AudioFormat.ENCODING_PCM_16BIT; src.bits > 24 -> AudioFormat.ENCODING_PCM_32BIT; else -> AudioFormat.ENCODING_PCM_24BIT_PACKED }
                val atRate = mixers(dac).filter { it.format.sampleRate == src.rate }
                val pick = atRate.firstOrNull { it.format.encoding == want }
                    ?: atRate.maxByOrNull { Source.bitsOf(it.format.encoding) }
                if (pick != null && am.setPreferredMixerAttributes(attrs, dac, pick)) {
                    mixerRate = pick.format.sampleRate
                    mixerBits = Source.bitsOf(pick.format.encoding)
                } else {
                    // the DAC doesn't take this rate (88.2 kHz on the Protocol Micro): Android's mixer converts it
                    am.clearPreferredMixerAttributes(attrs, dac)
                    mixerRate = 0
                    mixerBits = 0
                }
            }
            val mask = if (src.channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
            val fmt = AudioFormat.Builder().setSampleRate(src.rate).setEncoding(src.encoding).setChannelMask(mask).build()
            val min = AudioTrack.getMinBufferSize(src.rate, mask, src.encoding)
            val t = AudioTrack.Builder().setAudioAttributes(attrs).setAudioFormat(fmt)
                .setBufferSizeInBytes(maxOf(min * 4, src.rate * src.frameBytes / 2))
                .setTransferMode(AudioTrack.MODE_STREAM).build()
            t.preferredDevice = dac
            applyGain(t, src.gain)
            track = t
            trackKey = keyOf(src)
            written = 0
            headRaw = 0
            headWraps = 0
            Log.i(TAG, "open ${src.mime} ${src.rate} Hz ${src.bits}-bit → mixer ${mixerRate} Hz ${mixerBits}-bit")
        }

        private fun keyOf(s: Source) = "${s.rate}/${s.channels}/${s.encoding}"

        fun queue(src: Source?) = synchronized(lock) {
            next?.release()
            next = src
        }

        fun pause() = synchronized(lock) { paused = true; runCatching { track?.pause() }; lock.notifyAll() }
        // not resume(): Thread.resume() is final and ART refuses to load the class
        fun unpause() = synchronized(lock) { paused = false; runCatching { track?.play() }; lock.notifyAll() }
        fun seek(s: Double) = synchronized(lock) { seekTo = s; lock.notifyAll() }
        fun setGain(g: Double) = synchronized(lock) { cur.gain = g; segments.lastOrNull()?.src?.gain = g; applyGain(track, g) }
        fun reapplyGain() = synchronized(lock) { applyGain(track, segments.firstOrNull()?.src?.gain ?: cur.gain) }
        fun quit() = synchronized(lock) { quitting = true; lock.notifyAll() }

        private fun head(): Long = synchronized(lock) {
            val raw = (track?.playbackHeadPosition ?: 0).toLong() and 0xFFFFFFFFL
            if (raw < headRaw) headWraps++
            headRaw = raw
            (headWraps shl 32) + raw
        }

        fun position(): Double = synchronized(lock) {
            val seg = segments.firstOrNull() ?: return 0.0
            val rate = seg.src.rate.coerceAtLeast(1)
            seg.offsetSec + (head() - seg.startFrame).coerceAtLeast(0) / rate.toDouble()
        }

        fun state(): JSObject = JSObject().put("position", position())
            .put("duration", (segments.firstOrNull()?.src?.durationUs ?: 0L) / 1e6).put("playing", !paused)

        /** Moves on to the queued song once the DAC has actually reached it. */
        private fun tick(force: Boolean = false) {
            val h = head()
            while (segments.size > 1 && h >= segments.elementAt(1).startFrame) {
                val old = segments.removeFirst()
                if (old.src !== cur) old.src.release()
                val now = segments.first().src
                applyGain(track, now.gain)
                notifyListeners("advance", info(now))
            }
            val t = SystemClock.elapsedRealtime()
            if (force || t - lastState >= 250) {
                lastState = t
                notifyListeners("state", state())
            }
        }

        override fun run() {
            try {
                loop()
            } catch (e: Exception) {
                Log.e(TAG, "playback failed", e)
                if (!quitting) notifyListeners("error", JSObject().put("message", e.message ?: e.toString()))
            } finally {
                track?.let { runCatching { it.stop() }; it.release() }
                segments.forEach { it.src.release() }
                if (segments.none { it.src === cur }) cur.release()
                next?.release()
                if (Build.VERSION.SDK_INT >= 34) runCatching { am.clearPreferredMixerAttributes(attrs, dac) }
            }
        }

        private fun loop() {
            if (!paused) track?.play()
            var block: ByteArray? = null
            var off = 0
            while (true) {
                synchronized(lock) {
                    while (paused && !quitting && seekTo == null) lock.wait(250)
                }
                if (quitting) return
                val s = synchronized(lock) { seekTo.also { seekTo = null } }
                if (s != null) {
                    val t = track!!
                    t.pause()
                    t.flush()
                    synchronized(lock) {
                        // mid gapless join the screen still shows the song before: seek that one, the new one goes back to next
                        val shown = segments.first().src
                        if (shown !== cur) {
                            cur.seek(0)
                            next?.release()
                            next = cur
                            cur = shown
                        }
                        segments.filter { it.src !== cur }.forEach { if (it.src !== next) it.src.release() }
                        segments.clear()
                        segments.add(Segment(0, s, cur))
                        written = 0; headRaw = 0; headWraps = 0
                    }
                    cur.seek((s * 1e6).toLong())
                    block = null
                    nearEndSent = false
                    if (!paused) t.play()
                    tick(true)
                }
                if (block == null) {
                    block = cur.next()
                    off = 0
                    if (block == null) {
                        if (!endOfSong()) return
                        continue
                    }
                    if (swapLR && cur.channels == 2) swapChannels(block, cur.frameBytes / 2)
                    if (!nearEndSent && cur.durationUs > 0 && cur.lastPtsUs > cur.durationUs - NEAR_END_US) {
                        nearEndSent = true
                        notifyListeners("nearEnd", JSObject())
                    }
                }
                // the ByteBuffer write takes every format; write(byte[]) refuses a float track (-3)
                val n = track!!.write(java.nio.ByteBuffer.wrap(block, off, block.size - off), block.size - off, AudioTrack.WRITE_NON_BLOCKING)
                if (n < 0) throw IllegalStateException("AudioTrack.write $n")
                off += n
                written += n / cur.frameBytes
                if (off >= block.size) block = null
                if (n == 0) sleep(5)
                tick()
            }
        }

        /** Swaps each frame's left and right sample in place; the bytes themselves are not changed. */
        private fun swapChannels(b: ByteArray, sample: Int) {
            var i = 0
            while (i + 2 * sample <= b.size) {
                for (k in 0 until sample) {
                    val x = b[i + k]; b[i + k] = b[i + sample + k]; b[i + sample + k] = x
                }
                i += 2 * sample
            }
        }

        /** The decoder ran out. Same format next: carry straight on (gapless). Otherwise drain, then re-open or end. */
        private fun endOfSong(): Boolean {
            val n = synchronized(lock) { next.also { next = null } }
            if (n != null && keyOf(n) == trackKey) {
                synchronized(lock) {
                    segments.add(Segment(written, 0.0, n))
                    cur = n
                }
                nearEndSent = false
                return true
            }
            // let what's written play out
            while (!quitting && head() < written) {
                if (paused) synchronized(lock) { lock.wait(250) } else sleep(20)
                if (seekTo != null) { n?.let { synchronized(lock) { if (next == null) next = it else it.release() } }; return true }
                tick()
            }
            if (quitting) { n?.release(); return false }
            tick(true)
            if (n == null) {
                notifyListeners("ended", JSObject())
                return false
            }
            synchronized(lock) {
                segments.filter { it.src !== n }.forEach { it.src.release() }
                segments.clear()
                segments.add(Segment(0, 0.0, n))
                cur = n
            }
            openTrack(n)
            if (!paused) track?.play()
            nearEndSent = false
            notifyListeners("advance", info(n))
            return true
        }
    }

    companion object {
        private const val TAG = "DirectDac"
        /** "nearEnd" this long before a song ends, so the next one is open in time for a gapless join. */
        private const val NEAR_END_US = 15_000_000L
        /** A streamed PC song is held in memory whole; past this (a long hi-res file) the web player plays it. */
        private const val MAX_STREAMED_BYTES = 200L * 1024 * 1024
    }
}
