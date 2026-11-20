package com.iemdreambracket.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import computer.iroh.Connection
import computer.iroh.Endpoint
import computer.iroh.EndpointOptions
import computer.iroh.EndpointTicket
import computer.iroh.IrohAndroid
import computer.iroh.SecretKey
import computer.iroh.presetN0
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey as AesKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The phone end of the phone ↔ PC link (plan §70 D2, §73.C, protocol in docs/link-protocol.md).
 *
 * - Durable state (`node-key.bin`, `paired-pcs.json`, `library-tracks.json`, `offline/`, `covers/`) lives in
 *   `context.noBackupFilesDir` (NOT `context.cacheDir`) so MIUI Cleaner / Xiaomi Security / Samsung Device Care never
 *   wipe pairing or metadata when clearing cache.
 * - Streamed PC songs are kept in a song cache in `context.cacheDir` (§88 C, 1 GB, oldest out first), so replays,
 *   Previous, a page restart and seeks don't download them again. Android may clear it; it refills as songs play.
 */
@CapacitorPlugin(name = "Link")
class LinkPlugin : Plugin() {
    companion object {
        @Volatile var instance: LinkPlugin? = null
        private const val TAG = "Link"
        private const val PREFS = "link"
        private const val KEY_ALIAS = "iemdream-link"
        private val ALPN = "iemdream/1".toByteArray()
        /** §88 C: songs streamed from the PC stay in the app's cache, oldest out first. Android may clear it; nothing breaks. */
        private const val SONG_CACHE_BYTES = 1024L * 1024 * 1024
        /** At most this many left-behind songs (a skip, a seek) finish downloading into the cache at once. */
        private const val MAX_DETACHED = 2
        private const val CHUNK = 256 * 1024
        /** The owner has this long to click Allow on the PC. */
        private const val PAIR_TIMEOUT_MS = 3 * 60_000L
        /** §81 A: while connected, ask the PC this often whether its library or playlists changed. */
        private const val POLL_MS = 10_000L
        /** A hello is tiny: no answer in this long means the connection is dead (e.g. the network changed under it). */
        private const val HELLO_TIMEOUT_MS = 5_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val endpointLock = Mutex()
    private val connLock = Mutex()
    private val coverSemaphore = Semaphore(4)
    private val coverMutex = Mutex()
    private val inFlightCovers = HashMap<String, Deferred<File?>>()
    @Volatile private var endpoint: Endpoint? = null
    @Volatile private var conn: Connection? = null
    /** Songs from the PC, already in the page's Track shape. */
    @Volatile private var tracks = JSONArray()
    @Volatile private var libraryVersion = -1
    /** "no longer accepts this phone": the PC removed it, or the pairing expired. */
    @Volatile private var refused = false
    @Volatile private var lastError: String? = null
    @Volatile private var lastLatencyMs: Long = -1L
    @Volatile private var activeLanBase: String? = null
    @Volatile private var activeLanToken: String? = null
    /** The PC's playlists number from its last hello (§81 A); -1 before the first. */
    @Volatile private var playlistsVersion = -1
    /** PC clock minus this phone's, from the last hello: the time in signed LAN requests is the PC's. */
    @Volatile private var pcClockOffsetMs = 0L
    private var lastNetwork: Network? = null
    private var networkJob: Job? = null
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            val before = lastNetwork
            lastNetwork = network
            // the first report is just the network the app started on
            if (before != network && (before != null || conn != null)) onNetworkSwitched()
        }
        override fun onLost(network: Network) {
            if (lastNetwork == network) lastNetwork = null
            // nothing to switch to yet; the next onAvailable does the work
            activeLanBase = null
            activeLanToken = null
        }
    }

    data class SongStreamResult(
        val mime: String,
        val status: Int,
        val contentLength: Long,
        val contentRange: String?,
        val acceptRanges: String?,
        val stream: InputStream,
    )

    // ---- §88 C: the song cache. A song is written there while it streams (a whole-file request only) and counts once
    // it arrived complete; replays, Previous, a page restart and seeks into it then read the file, not the network.
    private fun songCacheDir() = File(context.cacheDir, "link/songs").apply { mkdirs() }
    private val writing = java.util.Collections.synchronizedSet(HashSet<String>())
    private val detached = java.util.concurrent.atomic.AtomicInteger(0)

    private fun cachedSongFile(key: String): File? =
        File(songCacheDir(), key).takeIf { it.isFile && it.length() > 0 }?.also { it.setLastModified(System.currentTimeMillis()) }

    private fun cachedMime(key: String): String =
        runCatching { File(songCacheDir(), "$key.type").readText() }.getOrDefault("application/octet-stream")

    private fun rangeStart(rangeHeader: String?): Long? =
        rangeHeader?.let { Regex("^bytes=(\\d+)-").find(it)?.groupValues?.get(1)?.toLongOrNull() }

    private fun onMobileData(): Boolean = runCatching {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        cm.getNetworkCapabilities(cm.activeNetwork)?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) == true
    }.getOrDefault(false)

    inner class CacheWriter(private val key: String, private val mime: String, private val expected: Long) {
        private val part = File(songCacheDir(), "$key.part")
        private var out: java.io.OutputStream? = java.io.BufferedOutputStream(java.io.FileOutputStream(part), CHUNK)
        private var size = 0L
        val open: Boolean get() = out != null

        /** A Low Data song has no length to check against; it's only whole if its last Ogg page carries the end mark. */
        private val tail = if (expected <= 0 && mime.contains("ogg")) ByteArray(70_000) else null
        private var tailLen = 0

        fun write(b: ByteArray, off: Int, n: Int) {
            val o = out ?: return
            try {
                o.write(b, off, n)
                size += n
                if (tail != null) keepTail(tail, b, off, n)
            } catch (e: Exception) {
                abort()
            }
        }

        private fun keepTail(t: ByteArray, b: ByteArray, off: Int, n: Int) {
            if (n >= t.size) {
                System.arraycopy(b, off + n - t.size, t, 0, t.size)
                tailLen = t.size
                return
            }
            val keep = minOf(tailLen, t.size - n)
            System.arraycopy(t, tailLen - keep, t, 0, keep)
            System.arraycopy(b, off, t, keep, n)
            tailLen = keep + n
        }

        /** The last "OggS" page header in the tail has the end-of-stream flag (ffmpeg writes it only when it finishes). */
        private fun oggEnded(t: ByteArray): Boolean {
            var i = tailLen - 27
            while (i >= 0) {
                if (t[i] == 'O'.code.toByte() && t[i + 1] == 'g'.code.toByte() && t[i + 2] == 'g'.code.toByte() && t[i + 3] == 'S'.code.toByte()) {
                    return (t[i + 5].toInt() and 0x04) != 0
                }
                i--
            }
            return false
        }

        fun finish() {
            val o = out ?: return
            out = null
            var ok = runCatching { o.close() }.isSuccess && size > 0 && (expected <= 0 || size == expected) && (tail == null || oggEnded(tail))
            if (!ok && tail != null) Log.w(TAG, "Low Data copy of $key ended without its end mark: not kept")
            if (ok) ok = runCatching { File(songCacheDir(), "$key.type").writeText(mime) }.isSuccess && part.renameTo(File(songCacheDir(), key))
            if (!ok) part.delete()
            writing.remove(key)
            if (ok) trimSongCache()
        }

        fun abort() {
            val o = out ?: return
            out = null
            runCatching { o.close() }
            part.delete()
            writing.remove(key)
        }
    }

    private fun startCacheWrite(key: String, mime: String, expected: Long): CacheWriter? {
        if (cachedSongFile(key) != null || !writing.add(key)) return null
        return runCatching { CacheWriter(key, mime, expected) }.getOrElse { writing.remove(key); null }
    }

    private fun trimSongCache() {
        val all = songCacheDir().listFiles() ?: return
        val stale = System.currentTimeMillis() - 3_600_000L
        all.filter { it.name.endsWith(".part") && it.lastModified() < stale && it.name.removeSuffix(".part") !in writing }.forEach { it.delete() }
        val songs = all.filter { it.isFile && !it.name.endsWith(".type") && !it.name.endsWith(".part") }
        var total = songs.sumOf { it.length() }
        for (f in songs.sortedBy { it.lastModified() }) {
            if (total <= SONG_CACHE_BYTES) break
            total -= f.length()
            f.delete()
            File(songCacheDir(), "${f.name}.type").delete()
        }
    }

    /** A cached or offline file as a response; a range is answered from its start to the end of the file. */
    private fun fileResult(f: File, mime: String, rangeHeader: String?): SongStreamResult? = runCatching {
        val len = f.length()
        val start = rangeStart(rangeHeader)
        val input = FileInputStream(f)
        if (start == null) return@runCatching SongStreamResult(mime, 200, len, null, "bytes", input)
        if (start >= len) {
            input.close()
            return@runCatching null
        }
        // shortcut: "bytes=a-b" is answered to the end of the file; the WebView's player only asks open-ended ranges
        var skipped = 0L
        while (skipped < start) {
            val k = input.skip(start - skipped)
            if (k <= 0) break
            skipped += k
        }
        SongStreamResult(mime, 206, len - start, "bytes $start-${len - 1}/$len", "bytes", input)
    }.getOrNull()

    /**
     * The network stream as the player reads it, copied into the cache on the way. When the player lets go early (a
     * skip, a seek), the rest still downloads into the cache in the background, except on mobile data without Low Data.
     */
    private fun cachingStream(src: InputStream, writer: CacheWriter?, lowData: Boolean, release: () -> Unit): InputStream = object : InputStream() {
        private var done = false

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        private var total = 0L
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            val n = try {
                src.read(b, off, len)
            } catch (e: Exception) {
                Log.w(TAG, "stream read failed after $total bytes: $e")
                throw e
            }
            if (n < 0) {
                writer?.finish()
            } else if (n > 0) {
                total += n
                writer?.write(b, off, n)
            }
            return n
        }

        override fun close() {
            if (done) return
            done = true
            if (writer != null && writer.open && detached.get() < MAX_DETACHED && (lowData || !onMobileData())) {
                detached.incrementAndGet()
                scope.launch(Dispatchers.IO) {
                    try {
                        val buf = ByteArray(CHUNK)
                        while (true) {
                            val n = src.read(buf, 0, buf.size)
                            if (n < 0) {
                                writer.finish()
                                break
                            }
                            writer.write(buf, 0, n)
                        }
                    } catch (e: Exception) {
                        writer.abort()
                    } finally {
                        detached.decrementAndGet()
                        runCatching { src.close() }
                        release()
                    }
                }
                return
            }
            writer?.abort()
            runCatching { src.close() }
            release()
        }
    }

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    /** Durable directory in noBackupFilesDir so system cache cleaners never delete pairing or metadata. */
    private fun stateDir() = File(context.noBackupFilesDir, "link").apply { mkdirs() }
    private fun nodeKeyFile() = File(stateDir(), "node-key.bin")
    private fun pairedPcsFile() = File(stateDir(), "paired-pcs.json")
    private fun tracksMetaFile() = File(stateDir(), "library-tracks.json")
    private fun coversDir() = File(stateDir(), "covers").apply { mkdirs() }
    private fun offlineDir() = File(stateDir(), "offline").apply { mkdirs() }

    private fun readPairedPc(): JSONObject? {
        val f = pairedPcsFile()
        if (f.exists()) {
            runCatching { return JSONObject(f.readText(Charsets.UTF_8)) }
        }
        val legacyTicket = prefs().getString("ticket", null)
        if (!legacyTicket.isNullOrEmpty()) {
            val legacyName = prefs().getString("name", "PC") ?: "PC"
            val obj = JSONObject().put("ticket", legacyTicket).put("name", legacyName)
            savePairedPc(legacyTicket, legacyName)
            return obj
        }
        return null
    }

    private fun savePairedPc(ticket: String, name: String) {
        val obj = JSONObject()
            .put("ticket", ticket)
            .put("name", name)
            .put("updatedAt", System.currentTimeMillis())
        runCatching { pairedPcsFile().writeText(obj.toString(), Charsets.UTF_8) }
        prefs().edit().putString("ticket", ticket).putString("name", name).apply()
    }

    private fun clearPairedPc() {
        runCatching { pairedPcsFile().delete() }
        runCatching { tracksMetaFile().delete() }
        prefs().edit().remove("ticket").remove("name").apply()
    }

    private fun ticket(): String? = readPairedPc()?.optString("ticket", "")?.takeIf { it.isNotEmpty() }
    private fun paired() = ticket() != null
    private fun pcName() = readPairedPc()?.optString("name", "PC")?.takeIf { it.isNotEmpty() } ?: "PC"

    /**
     * When the PC acts as Master and removes/disconnects this phone, immediately cease the connection,
     * unpair this phone, drop all PC library songs and caches, and notify the UI.
     */
    private fun onPcMasterDisconnect() {
        runCatching { conn?.close(0L, ByteArray(0)) }
        conn = null
        activeLanBase = null
        activeLanToken = null
        clearPairedPc()
        runCatching { songCacheDir().deleteRecursively() }
        tracks = JSONArray()
        libraryVersion = -1
        lastLatencyMs = -1L
        refused = false
        lastError = "Disconnected by PC"
        runCatching { coversDir().deleteRecursively() }
        runCatching { offlineDir().deleteRecursively() }
        ShellHostPlugin.get()?.linkChanged()
        notifyListeners("changed", JSObject())
    }

    private fun isUnpairedReason(reason: String?): Boolean {
        if (reason == null) return false
        val low = reason.lowercase()
        return low.contains("not paired") || low.contains("removed") || low.contains("unpaired")
    }

    /** §84 A: our own error("removed") / error("not paired"), not any failure that happens to contain the word. */
    private fun isOwnUnpairError(message: String?) = message == "removed" || message == "not paired"

    override fun load() {
        instance = this
        IrohAndroid.installAndroidContext(context.applicationContext)
        runCatching { context.getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(networkCallback) }
        // Clean up any legacy flash-cached PC songs in cacheDir so 0 MB of cache storage is wasted
        scope.launch {
            runCatching { File(context.cacheDir, "link/songs").deleteRecursively() }
            loadSavedMetadata()
            // Defer heavy network library sync by 3s so cold start / immediate play has 100% bandwidth
            delay(3000L)
            if (paired()) {
                runCatching { pingAndSync() }
            }
            // Background watchdog so if the PC disconnects/removes this phone while idle, the phone ceases connection
            while (true) {
                delay(4000L)
                if (!paired()) continue
                val c = conn
                if (c != null) {
                    val reason = runCatching { c.closeReason() }.getOrNull()?.toString()
                    if (reason != null) {
                        if (isUnpairedReason(reason)) {
                            onPcMasterDisconnect()
                        } else {
                            // Verify with the PC whether we were removed or just had an idle network drop
                            runCatching { pingAndSync() }
                        }
                    } else if (SystemClock.elapsedRealtime() - lastHelloAt >= POLL_MS) {
                        // §81 A: connected and quiet: has anything changed on the PC?
                        runCatching { pollPc() }
                    }
                } else {
                    // PC may have rebooted or reconnected to same Wi-Fi: automatically attempt reconnection
                    runCatching { pingAndSync() }
                }
            }
        }
    }

    /**
     * §81 B: the phone moved to another network (Wi-Fi ↔ mobile data). The old LAN address and the old connection are
     * dead but don't know it yet, so they're dropped here and the PC is dialled again from a fresh endpoint; anything
     * waiting on the old connection fails at once and retries on the new one.
     */
    private fun onNetworkSwitched() {
        networkJob?.cancel()
        networkJob = scope.launch {
            delay(800L) // one switch reports several times
            if (!paired()) return@launch
            Log.i(TAG, "network changed: reconnecting")
            activeLanBase = null
            activeLanToken = null
            // the endpoint first and outside connLock: a dial stuck on the dead network holds that lock until this ends it
            val oldConn = conn
            val oldEndpoint = endpointLock.withLock { endpoint.also { endpoint = null } }
            runCatching { oldConn?.close(0L, "network changed".toByteArray()) }
            // §84 A: wait for the old endpoint to finish. Two endpoints with one key at once made the relay and the PC
            // talk to the wrong one ("authentication failed" bursts in the PC log).
            if (oldEndpoint != null) {
                runCatching { withTimeout(10_000L) { oldEndpoint.shutdown() } }
                    .onFailure { Log.w(TAG, "old endpoint slow to shut down: ${it.message}") }
            }
            connLock.withLock { if (conn === oldConn) conn = null }
            runCatching { pingNow() }
        }
    }

    override fun handleOnDestroy() {
        runCatching { context.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(networkCallback) }
        super.handleOnDestroy()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        if (paired()) {
            scope.launch { runCatching { pingAndSync() } }
        }
    }

    private fun loadSavedMetadata() {
        val f = tracksMetaFile()
        if (!f.exists()) return
        runCatching {
            val saved = JSONObject(f.readText(Charsets.UTF_8))
            val arr = saved.optJSONArray("tracks")
            if (arr != null && arr.length() > 0) {
                tracks = markOfflineFlags(arr)
                libraryVersion = saved.optInt("version", -1)
                ShellHostPlugin.get()?.linkChanged()
                notifyListeners("changed", JSObject())
            }
        }
    }

    private fun saveTracksMetadata(arr: JSONArray, ver: Int) {
        runCatching {
            val obj = JSONObject().put("version", ver).put("tracks", arr)
            tracksMetaFile().writeText(obj.toString(), Charsets.UTF_8)
        }
    }

    private fun markOfflineFlags(arr: JSONArray): JSONArray {
        val offDir = offlineDir()
        for (i in 0 until arr.length()) {
            val t = arr.optJSONObject(i) ?: continue
            val rawId = t.optString("path", "").removePrefix("pc:")
            if (rawId.isNotEmpty()) {
                t.put("downloaded", File(offDir, rawId).exists())
            }
        }
        return arr
    }

    // ---- the phone's key, wrapped by Android Keystore and stored in noBackupFilesDir/link/node-key.bin

    private fun wrappingKey(): AesKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? AesKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun phoneKey(): ByteArray {
        val keyFile = nodeKeyFile()
        val storedBytes: ByteArray? = when {
            keyFile.exists() -> runCatching { keyFile.readBytes() }.getOrNull()
            else -> prefs().getString("key", null)?.let { runCatching { Base64.decode(it, Base64.NO_WRAP) }.getOrNull() }
        }
        if (storedBytes != null && storedBytes.size > 12) {
            runCatching {
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, storedBytes, 0, 12))
                val unsealed = c.doFinal(storedBytes, 12, storedBytes.size - 12)
                if (!keyFile.exists()) runCatching { keyFile.writeBytes(storedBytes) }
                return unsealed
            }
        }
        // none yet (or the Keystore key is gone, e.g. after a restore): a new key, and the PC has to be paired again
        val key = SecretKey.generate().toBytes()
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, wrappingKey())
        val sealed = c.iv + c.doFinal(key)
        runCatching { keyFile.writeBytes(sealed) }
        clearPairedPc()
        prefs().edit().putString("key", Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
        return key
    }

    // ---- the connection

    private suspend fun endpoint(): Endpoint = endpointLock.withLock {
        endpoint?.let { if (!it.isClosed()) return it }
        val ep = Endpoint.bind(EndpointOptions(preset = presetN0(), secretKey = phoneKey()))
        endpoint = ep
        return ep
    }

    private suspend fun connection(): Connection = connLock.withLock {
        conn?.let {
            val cr = runCatching { it.closeReason() }.getOrNull()?.toString()
            if (cr == null) return it
            if (isUnpairedReason(cr)) {
                onPcMasterDisconnect()
                error("not paired")
            }
            conn = null
        }
        val t = ticket() ?: error("not paired")
        // a dial that can't finish (no network, PC off) gives up instead of holding connLock for good
        val c = withTimeout(15_000L) { endpoint().connect(EndpointTicket.fromString(t).endpointAddr(), ALPN) }
        conn = c
        scope.launch {
            val why = runCatching { c.closed() }.getOrNull() ?: ""
            if (isUnpairedReason(why)) {
                onPcMasterDisconnect()
            }
        }
        c
    }

    /** One request; the header and the whole body (small answers only: hello, library, pair). */
    private suspend fun ask(c: Connection, request: JSONObject, bodyLimit: Int = 64 shl 20): Pair<JSONObject, ByteArray> {
        val bi = c.openBi()
        bi.send().writeAll((request.toString() + "\n").toByteArray())
        bi.send().finish()
        val all = bi.recv().readToEnd(bodyLimit.toUInt())
        val nl = all.indexOf('\n'.code.toByte())
        if (nl < 0) error("no answer")
        val head = JSONObject(String(all, 0, nl, Charsets.UTF_8))
        if (head.optBoolean("unpaired", false) || isUnpairedReason(head.optString("error", ""))) {
            onPcMasterDisconnect()
            error("removed")
        }
        return head to all.copyOfRange(nl + 1, all.size)
    }

    private suspend fun <T> withConnection(block: suspend (Connection) -> T): T {
        val c1 = connection()
        return try {
            block(c1)
        } catch (e: Exception) {
            val why1 = runCatching { c1.closeReason()?.toString() ?: withTimeout(400L) { c1.closed().toString() } }.getOrNull() ?: e.message ?: ""
            if (isUnpairedReason(why1) || isOwnUnpairError(e.message) || !paired()) {
                if (paired()) onPcMasterDisconnect()
                throw e
            }
            // a dropped connection (network switch, PC asleep): dial again once. The old one is closed, not just
            // forgotten (the PC kept every forgotten one open until it timed out), and only if it is still the
            // shared one (another caller may already have dialled a fresh one).
            runCatching { c1.close(0L, ByteArray(0)) }
            connLock.withLock { if (conn === c1) conn = null }
            val c2 = connection()
            try {
                block(c2)
            } catch (e2: Exception) {
                val why2 = runCatching { c2.closeReason()?.toString() ?: withTimeout(400L) { c2.closed().toString() } }.getOrNull() ?: e2.message ?: ""
                if (isUnpairedReason(why2) || isOwnUnpairError(e2.message)) {
                    onPcMasterDisconnect()
                }
                throw e2
            }
        }
    }

    private suspend fun refreshLibrary() {
        runCatching {
            val t0 = SystemClock.elapsedRealtime()
            val (head, body) = withConnection { ask(it, JSONObject().put("op", "library").put("since", libraryVersion)) }
            lastLatencyMs = (SystemClock.elapsedRealtime() - t0).coerceAtLeast(1L)
            if (!head.optBoolean("ok")) error(head.optString("error"))
            refused = false
            lastError = null
            if (head.optBoolean("same")) {
                notifyListeners("changed", JSObject())
                return
            }
            val list = JSONArray(String(body, Charsets.UTF_8))
            val name = pcName()
            val offDir = offlineDir()
            val out = JSONArray()
            for (i in 0 until list.length()) {
                val w = list.getJSONObject(i)
                val rawId = w.getString("id")
                out.put(JSONObject().apply {
                    put("id", "pc_$rawId")
                    put("path", "pc:$rawId")
                    put("folder", "/$name/")
                    put("root", "$name/")
                    put("source", "pc")
                    put("playable", w.optBoolean("playable", true))
                    for (k in listOf("title", "artist", "albumArtist", "album", "genre", "format")) put(k, w.optString(k, ""))
                    for (k in listOf("track", "disc", "year", "bits", "rate", "sec", "size", "kbps", "added")) put(k, w.optLong(k, 0))
                    put("trackTotal", 0); put("date", if (w.optLong("year") > 0) w.optLong("year").toString() else "")
                    put("label", ""); put("isrc", ""); put("isrcOk", false); put("lyrics", false); put("replayGain", false)
                    put("downloaded", File(offDir, rawId).exists())
                    put("lossy", w.optBoolean("lossy"))
                    put("cover", if (w.optString("cover").isNotEmpty()) "pc_" + w.getString("cover") else "")
                })
            }
            tracks = out
            libraryVersion = head.optInt("version")
            saveTracksMetadata(out, libraryVersion)
            ShellHostPlugin.get()?.linkChanged()
            notifyListeners("changed", JSObject())
        }.onFailure {
            lastError = it.message
            Log.w(TAG, "library: ${it.message}")
            notifyListeners("changed", JSObject())
        }
    }

    /** §84 A: the PC's address as of now (sent over the verified link), kept for the next dial away from home. */
    private fun keepFreshTicket(head: JSONObject) {
        val fresh = head.optString("ticket", "")
        if (fresh.isEmpty() || fresh == ticket()) return
        if (runCatching { EndpointTicket.fromString(fresh) }.isFailure) return
        savePairedPc(fresh, pcName())
        Log.i(TAG, "PC address updated")
    }

    private fun probeLanFromHello(head: JSONObject) {
        keepFreshTicket(head)
        val lan = head.optJSONObject("lan") ?: run {
            activeLanBase = null
            activeLanToken = null
            return
        }
        val port = lan.optInt("port", 0)
        val token = lan.optString("token", "")
        val ipsArr = lan.optJSONArray("ips")
        if (port <= 0 || token.isEmpty() || ipsArr == null || ipsArr.length() == 0) {
            activeLanBase = null
            activeLanToken = null
            return
        }
        val curBase = activeLanBase
        if (curBase != null && token == activeLanToken) {
            // Fast verify current active LAN base
            if (pingLanEndpoint(curBase, token)) return
        }
        for (i in 0 until ipsArr.length()) {
            val ip = ipsArr.optString(i, "").trim()
            if (ip.isEmpty()) continue
            val candidate = "http://$ip:$port"
            if (pingLanEndpoint(candidate, token)) {
                activeLanBase = candidate
                activeLanToken = token
                return
            }
        }
        activeLanBase = null
        activeLanToken = null
    }

    private fun pingLanEndpoint(base: String, token: String): Boolean {
        var c: HttpURLConnection? = null
        return try {
            c = (URL("$base/ping").openConnection() as HttpURLConnection).apply {
                connectTimeout = 600
                readTimeout = 600
            }
            signLan(c, token)
            c.responseCode == 200
        } catch (_: Exception) {
            false
        } finally {
            runCatching { c?.disconnect() }
        }
    }

    /** This phone's name for the PC (§81 F): the device name from Android's settings, else "Android <version>". */
    private fun deviceName(): String {
        val own = prefs().getString("deviceName", "").orEmpty().trim()
        if (own.isNotEmpty()) return own.take(40)
        val set = runCatching { Settings.Global.getString(context.contentResolver, "device_name") }.getOrNull()?.trim().orEmpty()
        return set.ifEmpty { "Android ${Build.VERSION.RELEASE}" }.take(40)
    }

    /** Adds who this phone is to a hello or pair request: its name, model number and Android version. */
    private fun withAbout(req: JSONObject): JSONObject =
        req.put("name", deviceName()).put("model", (Build.MODEL ?: "").take(40)).put("os", "Android ${Build.VERSION.RELEASE}")

    @Volatile private var lastHelloAt = 0L

    /** One hello. No answer in HELLO_TIMEOUT_MS means the connection is dead: it's dropped, so the next request dials again. */
    private suspend fun hello(): JSONObject {
        val head = try {
            withConnection { c -> withTimeout(HELLO_TIMEOUT_MS) { ask(c, withAbout(JSONObject().put("op", "hello"))) }.first }
        } catch (e: Exception) {
            connLock.withLock {
                runCatching { conn?.close(0L, "no answer".toByteArray()) }
                conn = null
            }
            throw e
        }
        lastHelloAt = SystemClock.elapsedRealtime()
        if (head.optLong("now", 0L) > 0L) pcClockOffsetMs = head.optLong("now") - System.currentTimeMillis()
        return head
    }

    /** True when the PC's playlists number moved since the last hello (the first one counts: the page pulls on connect anyway). */
    private fun playlistsMoved(head: JSONObject): Boolean {
        val v = head.optInt("playlists", -1)
        val moved = v != playlistsVersion
        playlistsVersion = v
        return moved
    }

    /** §81 A: the quiet check while connected. Fetches the library only when its number moved; tells the page when the playlists' did. */
    private suspend fun pollPc() {
        val head = hello()
        if (!head.optBoolean("ok")) return
        val lan = head.optJSONObject("lan")
        if (lan != null && lan.optString("token") != activeLanToken && activeLanBase != null) probeLanFromHello(head)
        val lists = playlistsMoved(head)
        if (head.optInt("library", libraryVersion) != libraryVersion) refreshLibrary()
        else if (lists) notifyListeners("changed", JSObject())
    }

    /** §81: a LAN request is signed with the token (HMAC-SHA256 over the method, the path and the PC's time); the token itself never crosses the Wi-Fi. */
    private fun signLan(c: HttpURLConnection, token: String) {
        val t = System.currentTimeMillis() + pcClockOffsetMs
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(token.toByteArray(), "HmacSHA256")) }
        val sig = mac.doFinal("${c.requestMethod}\n${c.url.file}\n$t".toByteArray()).joinToString("") { "%02x".format(it) }
        c.setRequestProperty("Authorization", "AVSB t=$t, sig=$sig")
    }

    /** Pings the PC via 'hello' to pre-warm direct UDP/LAN paths, records latencyMs, and refreshes the library. */
    @Volatile private var pingJob: Deferred<JSObject>? = null

    /** §84 A: resume, the watchdog and the page all ask at once; they share one ping instead of dialling three times. */
    private suspend fun pingAndSync(): JSObject {
        pingJob?.takeIf { it.isActive }?.let { return it.await() }
        val job = scope.async { pingNow() }
        pingJob = job
        return job.await()
    }

    private suspend fun pingNow(): JSObject {
        if (!paired()) return buildStatusJson()
        runCatching {
            val t0 = SystemClock.elapsedRealtime()
            val head = hello()
            playlistsMoved(head)
            val dt = (SystemClock.elapsedRealtime() - t0).coerceAtLeast(1L)
            if (!head.optBoolean("ok")) error(head.optString("error", "ping failed"))
            lastLatencyMs = dt
            refused = false
            lastError = null
            probeLanFromHello(head)
        }.onFailure {
            lastError = it.message
        }
        refreshLibrary()
        return buildStatusJson()
    }

    // ---- for ShellHostPlugin (its WebView thread may block here)

    /** The PC's songs as page Tracks. */
    fun libraryTracks(): JSONArray = tracks

    private fun openLanSongStream(
        id: String,
        lowData: Boolean,
        rangeHeader: String?,
        cacheKey: String,
    ): SongStreamResult? {
        val base = activeLanBase ?: return null
        val token = activeLanToken ?: return null
        val q = if (lowData) 1 else 0
        var httpConn: HttpURLConnection? = null
        return try {
            val url = URL("$base/song/${Uri.encode(id)}?lowdata=$q")
            httpConn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 1500
                readTimeout = 20000
                if (!rangeHeader.isNullOrEmpty()) {
                    setRequestProperty("Range", rangeHeader)
                }
            }
            signLan(httpConn, token)
            val code = httpConn.responseCode
            if (code == 401 || code == 403) {
                activeLanBase = null
                activeLanToken = null
                httpConn.disconnect()
                return null
            }
            if (code != 200 && code != 206) {
                httpConn.disconnect()
                return null
            }
            val mime = (httpConn.contentType ?: "application/octet-stream").substringBefore(';').trim().ifEmpty { "application/octet-stream" }
            val len = httpConn.contentLengthLong
            val contentRange = httpConn.getHeaderField("Content-Range")
            val acceptRanges = httpConn.getHeaderField("Accept-Ranges")
            val rawIn = httpConn.inputStream
            val whole = rangeStart(rangeHeader).let { it == null || it == 0L }
            val total = contentRange?.substringAfterLast('/')?.toLongOrNull() ?: len
            val writer = if (whole) startCacheWrite(cacheKey, mime, total) else null
            val conn = httpConn
            SongStreamResult(mime, code, len, contentRange, acceptRanges, cachingStream(rawIn, writer, lowData) { runCatching { conn.disconnect() } })
        } catch (e: Exception) {
            Log.w(TAG, "LAN stream fallback for $id: ${e.message}")
            runCatching { httpConn?.disconnect() }
            activeLanBase = null
            activeLanToken = null
            null
        }
    }

    fun songStream(id: String, lowData: Boolean = false): Pair<String, InputStream>? {
        val res = openSongStream(id, lowData, null) ?: return null
        return res.mime to res.stream
    }

    /**
     * §73.C1 — Zero-Storage In-Memory Streaming:
     * Prefers direct LAN HTTP (`Range`/`206` & piped 128 kbps Opus) when on local Wi-Fi, seamlessly falling back to
     * `iroh` QUIC when remote/relayed, backed by bounded RAM LRU cache (`0 MB` flash storage used unless saved offline).
     */
    fun openSongStream(id: String, lowData: Boolean = false, rangeHeader: String? = null): SongStreamResult? {
        if (!Regex("^[A-Za-z0-9_-]{1,64}$").matches(id) || !paired()) return null
        val cacheKey = if (lowData) "$id-low" else id
        File(offlineDir(), id).takeIf { it.exists() }?.let { f -> fileResult(f, "application/octet-stream", rangeHeader)?.let { return it } }
        cachedSongFile(cacheKey)?.let { f -> fileResult(f, cachedMime(cacheKey), rangeHeader)?.let { return it } }
        openLanSongStream(id, lowData, rangeHeader, cacheKey)?.let { return it }
        // §84 A: a seek asks for "bytes=N-"; the PC resumes the file there (low data is transcoded live, so it restarts)
        val from = if (lowData) 0L else Regex("^bytes=(\\d+)-").find(rangeHeader ?: "")?.groupValues?.get(1)?.toLongOrNull() ?: 0L
        return runBlocking(Dispatchers.IO) {
            runCatching {
                withConnection { c ->
                    val bi = c.openBi()
                    bi.send().writeAll((JSONObject().put("op", "song").put("id", id).put("from", from).put("lowData", lowData).toString() + "\n").toByteArray())
                    bi.send().finish()
                    val headerBuf = ByteArrayOutputStream(512)
                    var nl = -1
                    var fullHeaderBytes = ByteArray(0)
                    while (true) {
                        val got = bi.recv().read(CHUNK.toUInt())
                        if (got.isEmpty()) error("no answer")
                        val offsetBefore = headerBuf.size()
                        headerBuf.write(got)
                        val rel = got.indexOf('\n'.code.toByte())
                        if (rel >= 0) {
                            nl = offsetBefore + rel
                            fullHeaderBytes = headerBuf.toByteArray()
                            break
                        }
                        if (headerBuf.size() > 64 * 1024) error("header too large")
                    }
                    val head = JSONObject(String(fullHeaderBytes, 0, nl, Charsets.UTF_8))
                    if (head.optBoolean("unpaired", false) || isUnpairedReason(head.optString("error", ""))) {
                        onPcMasterDisconnect()
                        error("removed")
                    }
                    if (!head.optBoolean("ok")) error(head.optString("error"))
                    val mime = head.optString("type", "application/octet-stream").ifEmpty { "application/octet-stream" }
                    val expectedSize = head.optLong("size", -1L)
                    val initialBytes = fullHeaderBytes.copyOfRange(nl + 1, fullHeaderBytes.size)
                    val recv = bi.recv()

                    // High-priority producer coroutine: bounds queued chunks to keep Java heap modest
                    val chunkQueue = java.util.concurrent.LinkedBlockingQueue<ByteArray>(24)
                    val producerError = java.util.concurrent.atomic.AtomicReference<Throwable?>(null)
                    val producerJob = scope.launch(Dispatchers.IO) {
                        // a blocking put() can't be cancelled: once the reader stops (song skipped) it held this thread
                        // and the QUIC stream forever. Offer with a timeout so close() → cancel() gets through.
                        fun hand(chunk: ByteArray): Boolean {
                            while (isActive) {
                                if (chunkQueue.offer(chunk, 1, java.util.concurrent.TimeUnit.SECONDS)) return true
                            }
                            return false
                        }
                        try {
                            while (isActive) {
                                val next = recv.read(CHUNK.toUInt())
                                if (next.isEmpty()) {
                                    hand(ByteArray(0))
                                    break
                                }
                                if (!hand(next)) break
                            }
                        } catch (e: Exception) {
                            producerError.set(e)
                            chunkQueue.offer(ByteArray(0))
                        } finally {
                            // tell the PC to stop sending, so its side doesn't wait on flow control with the file open
                            withContext(NonCancellable) { runCatching { recv.stop(0UL) } }
                        }
                    }

                    val stream = object : InputStream() {
                        private var cur: ByteArray = initialBytes
                        private var pos: Int = 0
                        private var eof: Boolean = false
                        private var closed: Boolean = false

                        private fun pullNextChunk(): Boolean {
                            if (eof || closed) return false
                            val next = try {
                                chunkQueue.poll(20, java.util.concurrent.TimeUnit.SECONDS)
                            } catch (e: InterruptedException) {
                                Thread.currentThread().interrupt()
                                eof = true
                                throw java.io.IOException("stream interrupted", e)
                            }
                            if (next == null) {
                                eof = true
                                throw java.io.IOException("PC stream stalled")
                            }
                            if (next.isEmpty()) {
                                eof = true
                                val err = producerError.get()
                                if (err != null) throw java.io.IOException("PC stream dropped: ${err.message}", err)
                                return false
                            }
                            cur = next
                            pos = 0
                            return true
                        }

                        override fun read(): Int {
                            while (pos >= cur.size) {
                                if (!pullNextChunk()) return -1
                            }
                            return cur[pos++].toInt() and 0xff
                        }

                        override fun read(b: ByteArray, off: Int, len: Int): Int {
                            if (len == 0) return 0
                            while (pos >= cur.size) {
                                if (!pullNextChunk()) return -1
                            }
                            val n = minOf(len, cur.size - pos)
                            System.arraycopy(cur, pos, b, off, n)
                            pos += n
                            return n
                        }

                        override fun close() {
                            closed = true
                            producerJob.cancel()
                            super.close()
                        }
                    }
                    val writer = if (from == 0L) startCacheWrite(cacheKey, mime, expectedSize) else null
                    val body = cachingStream(stream, writer, lowData) {}
                    when {
                        from > 0L && expectedSize > from -> SongStreamResult(mime, 206, expectedSize - from, "bytes $from-${expectedSize - 1}/$expectedSize", "bytes", body)
                        // the player asked "bytes=0-": answered as a range, or it takes the song for one it can't seek in
                        rangeHeader != null && expectedSize > 0L && !lowData -> SongStreamResult(mime, 206, expectedSize, "bytes 0-${expectedSize - 1}/$expectedSize", "bytes", body)
                        else -> SongStreamResult(mime, 200, expectedSize, null, if (lowData) null else "bytes", body)
                    }
                }
            }.onFailure { Log.w(TAG, "songStream $id: ${it.message}") }.getOrNull()
        }
    }

    /** Offline song file if explicitly saved offline. */
    fun songFile(id: String): File? {
        if (!Regex("^[A-Za-z0-9_-]{1,64}$").matches(id)) return null
        val f = File(offlineDir(), id)
        return if (f.exists()) f else null
    }

    fun coverFile(id: String): File? = runBlocking { fetchCoverToDir(id) }

    /** Removes a PC track from this phone's RAM and offline cache (§72.B5). */
    fun removeCachedTrack(rawId: String): Boolean {
        val id = rawId.removePrefix("pc_").removePrefix("pc:")
        var removed = false
        for (key in listOf(id, "$id-low")) {
            if (File(songCacheDir(), key).delete()) removed = true
            File(songCacheDir(), "$key.type").delete()
        }
        val f = File(offlineDir(), id)
        if (f.exists() && f.delete()) {
            removed = true
            tracks = markOfflineFlags(tracks)
            ShellHostPlugin.get()?.linkChanged()
        }
        return removed
    }

    private suspend fun fetchCoverToDir(id: String): File? {
        if (!Regex("^[A-Za-z0-9_-]{1,64}$").matches(id) || !paired()) return null
        val dir = coversDir()
        val done = File(dir, id)
        if (done.exists() && done.length() > 0L) {
            done.setLastModified(System.currentTimeMillis())
            return done
        }
        val deferred = coverMutex.withLock {
            inFlightCovers[id]?.let { return@withLock it }
            val job = scope.async {
                coverSemaphore.withPermit {
                    if (done.exists() && done.length() > 0L) return@withPermit done
                    val part = File(dir, "$id.${SystemClock.elapsedRealtimeNanos()}.part")
                    val lanBase = activeLanBase
                    val lanTok = activeLanToken
                    if (lanBase != null && lanTok != null) {
                        var c: HttpURLConnection? = null
                        val lanOk = runCatching {
                            c = (URL("$lanBase/cover/${Uri.encode(id)}").openConnection() as HttpURLConnection).apply {
                                connectTimeout = 1500
                                readTimeout = 8000
                            }
                            signLan(c!!, lanTok)
                            if (c!!.responseCode == 200) {
                                c!!.inputStream.use { input ->
                                    FileOutputStream(part, false).use { out ->
                                        input.copyTo(out, 16384)
                                    }
                                }
                                if (part.length() > 0L) {
                                    if (done.exists()) done.delete()
                                    part.renameTo(done)
                                    true
                                } else false
                            } else false
                        }.getOrDefault(false)
                        runCatching { c?.disconnect() }
                        if (lanOk && done.exists() && done.length() > 0L) {
                            return@withPermit done
                        }
                        part.delete()
                    }
                    runCatching {
                        withConnection { c ->
                            val bi = c.openBi()
                            bi.send().writeAll((JSONObject().put("op", "cover").put("id", id).toString() + "\n").toByteArray())
                            bi.send().finish()
                            val headerBuf = ByteArrayOutputStream(512)
                            var nl = -1
                            var headerAll = ByteArray(0)
                            while (true) {
                                val got = bi.recv().read(CHUNK.toUInt())
                                if (got.isEmpty()) error("no answer")
                                val offsetBefore = headerBuf.size()
                                headerBuf.write(got)
                                val rel = got.indexOf('\n'.code.toByte())
                                if (rel >= 0) {
                                    nl = offsetBefore + rel
                                    headerAll = headerBuf.toByteArray()
                                    break
                                }
                                if (headerBuf.size() > 64 * 1024) error("header too large")
                            }
                            val head = JSONObject(String(headerAll, 0, nl, Charsets.UTF_8))
                            if (head.optBoolean("unpaired", false) || isUnpairedReason(head.optString("error", ""))) {
                                onPcMasterDisconnect()
                                error("removed")
                            }
                            if (!head.optBoolean("ok")) error(head.optString("error"))
                            FileOutputStream(part, false).use { out ->
                                out.write(headerAll, nl + 1, headerAll.size - nl - 1)
                                while (true) {
                                    val got = bi.recv().read(CHUNK.toUInt())
                                    if (got.isEmpty()) break
                                    out.write(got)
                                }
                            }
                            if (part.length() != head.optLong("size")) {
                                part.delete()
                                error("incomplete")
                            }
                            if (done.exists()) done.delete()
                            part.renameTo(done)
                            done
                        }
                    }.onFailure {
                        part.delete()
                        Log.w(TAG, "cover $id: ${it.message}")
                    }.getOrNull()
                }
            }
            inFlightCovers[id] = job
            job
        }
        return try {
            deferred.await()
        } finally {
            coverMutex.withLock {
                if (inFlightCovers[id] === deferred) inFlightCovers.remove(id)
            }
        }
    }

    private fun buildStatusJson(): JSObject {
        val c = conn
        val alive = c != null && runCatching { c.closeReason() == null }.getOrDefault(false)
        val hasLan = alive && activeLanBase != null
        val quicPath = if (!alive) "" else runCatching {
            val sel = c!!.paths().firstOrNull { it.isSelected }
            when {
                sel == null -> ""
                sel.isRelay -> "relayed"
                else -> "direct"
            }
        }.getOrDefault("")
        val path = when {
            !alive -> ""
            hasLan -> "direct"
            else -> quicPath
        }
        val transport = when {
            !alive -> ""
            hasLan -> "lan-http"
            quicPath == "direct" -> "iroh-direct"
            quicPath == "relayed" -> "iroh-relayed"
            else -> ""
        }
        return JSObject().apply {
            put("paired", paired())
            put("name", pcName())
            put("connected", alive)
            put("path", path)
            put("transport", transport)
            put("latencyMs", if (alive && lastLatencyMs >= 0L) lastLatencyMs else JSObject.NULL)
            put("refused", refused)
            put("deviceName", deviceName())
            put("songs", tracks.length())
            put("error", lastError)
        }
    }

    // ---- page methods

    /** §81 F: the owner's own name for this phone ('' = Android's device name again); the PC hears it with the next hello. */
    @PluginMethod
    fun setName(call: PluginCall) {
        prefs().edit().putString("deviceName", (call.getString("name") ?: "").trim().take(40)).apply()
        scope.launch {
            if (paired()) runCatching { hello() }
            notifyListeners("changed", JSObject())
            call.resolve()
        }
    }

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(buildStatusJson())
    }

    /** §73.C3 — Pre-warms the peer connection, measures latency, and syncs the library list immediately. */
    @PluginMethod
    fun resync(call: PluginCall) {
        scope.launch {
            val st = pingAndSync()
            call.resolve(st)
        }
    }

    @PluginMethod
    fun ping(call: PluginCall) {
        scope.launch {
            val st = pingAndSync()
            call.resolve(st)
        }
    }

    /** One request line, then a body written by [body], on one stream; the PC's answer header. */
    private suspend fun askWithBody(c: Connection, request: JSONObject, body: suspend (suspend (ByteArray) -> Unit) -> Unit): JSONObject {
        val bi = c.openBi()
        bi.send().writeAll((request.toString() + "\n").toByteArray())
        body { bi.send().writeAll(it) }
        bi.send().finish()
        val all = bi.recv().readToEnd((64 shl 10).toUInt())
        val nl = all.indexOf('\n'.code.toByte())
        if (nl < 0) error("no answer")
        return JSONObject(String(all, 0, nl, Charsets.UTF_8))
    }

    /** §80 A: the PC's playlists as JSON (PC ids); no json when not paired or not reachable. */
    @PluginMethod
    fun playlists(call: PluginCall) {
        scope.launch {
            if (!paired()) return@launch call.resolve(JSObject())
            runCatching {
                val (head, body) = withConnection { ask(it, JSONObject().put("op", "playlists").put("since", -1)) }
                if (!head.optBoolean("ok")) error(head.optString("error"))
                JSObject().put("json", String(body, Charsets.UTF_8))
            }.onSuccess { call.resolve(it) }.onFailure { call.resolve(JSObject()) }
        }
    }

    /** §80 A: the phone's merged playlists (JSON, PC ids) for the PC. */
    @PluginMethod
    fun putPlaylists(call: PluginCall) {
        val json = call.getString("json") ?: return call.reject("no playlists")
        scope.launch {
            if (!paired()) return@launch call.reject("not paired")
            runCatching {
                val bytes = json.toByteArray(Charsets.UTF_8)
                val head = withConnection { askWithBody(it, JSONObject().put("op", "playlists-put").put("bytes", bytes.size)) { write -> write(bytes) } }
                if (!head.optBoolean("ok")) error(head.optString("error"))
            }.onSuccess { call.resolve() }.onFailure { call.reject(it.message ?: "failed") }
        }
    }

    /** §80 A: sends one of the phone's own songs into the PC's library ("From phone" in its first folder). */
    @PluginMethod
    fun upload(call: PluginCall) {
        val uri = call.getString("uri") ?: return call.reject("no song")
        val name = call.getString("name") ?: return call.reject("no name")
        // only songs from the phone's media index, never another app's files
        if (!uri.startsWith("content://media/")) return call.reject("not a song on this phone")
        scope.launch {
            if (!paired()) return@launch call.reject("Not paired with a PC")
            // copied first, so the PC is told the exact size before the bytes start
            val tmp = File(context.cacheDir, "link-upload.tmp")
            runCatching {
                context.contentResolver.openInputStream(Uri.parse(uri))?.use { inp -> tmp.outputStream().use { inp.copyTo(it) } } ?: error("can't read the song")
                val size = tmp.length()
                val head = withConnection { c ->
                    askWithBody(c, JSONObject().put("op", "upload").put("name", name).put("bytes", size)) { write ->
                        tmp.inputStream().use { inp ->
                            val buf = ByteArray(64 shl 10)
                            while (true) {
                                val n = inp.read(buf)
                                if (n <= 0) break
                                write(buf.copyOf(n))
                            }
                        }
                    }
                }
                if (!head.optBoolean("ok")) error(head.optString("error"))
                head.optString("name", name)
            }.also { tmp.delete() }
                .onSuccess { call.resolve(JSObject().put("name", it)) }
                .onFailure { call.reject(it.message ?: "failed") }
        }
    }

    /** §93 Batch 6: the page's own guess (navigator.connection) isn't filled in by Android's WebView. */
    @PluginMethod
    fun network(call: PluginCall) {
        call.resolve(JSObject().put("mobile", onMobileData()))
    }

    @PluginMethod
    fun isAirplaneMode(call: PluginCall) {
        val airplaneMode = Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0
        call.resolve(JSObject().put("airplaneMode", airplaneMode))
    }

    @PluginMethod
    fun testSpeed(call: PluginCall) {
        val airplaneMode = Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0
        scope.launch {
            val res = pingAndSync()
            res.put("airplaneMode", airplaneMode)
            if (airplaneMode) {
                call.resolve(res)
                return@launch
            }
            var speedMbps = 0.0
            if (res.optBoolean("connected", false)) {
                val lanBase = activeLanBase
                val lanTok = activeLanToken
                var measured = false
                if (lanBase != null && lanTok != null) {
                    var httpConn: HttpURLConnection? = null
                    runCatching {
                        val pingStart = SystemClock.elapsedRealtime()
                        if (pingLanEndpoint(lanBase, lanTok)) {
                            val rttMs = (SystemClock.elapsedRealtime() - pingStart).coerceAtLeast(1L)
                            lastLatencyMs = rttMs
                            res.put("latencyMs", rttMs)
                        }
                        // 4 MB timed from the response headers: 1 MB from before the connect mostly measured the setup (item 13)
                        httpConn = (URL("$lanBase/bench?bytes=4194304").openConnection() as HttpURLConnection).apply {
                            connectTimeout = 1500
                            readTimeout = 10000
                        }
                        signLan(httpConn!!, lanTok)
                        if (httpConn!!.responseCode == 200) {
                            val t0 = SystemClock.elapsedRealtime()
                            val buf = ByteArray(64 * 1024)
                            var totalBytes = 0L
                            httpConn!!.inputStream.use { input ->
                                while (true) {
                                    val n = input.read(buf)
                                    if (n < 0) break
                                    totalBytes += n
                                }
                            }
                            val dtMs = (SystemClock.elapsedRealtime() - t0).coerceAtLeast(1L)
                            if (totalBytes > 0L) {
                                speedMbps = (totalBytes * 8.0) / (dtMs / 1000.0) / 1_000_000.0
                                res.put("path", "direct")
                                res.put("transport", "lan-http")
                                measured = true
                            }
                        }
                    }.onFailure {
                        activeLanBase = null
                        activeLanToken = null
                    }
                    runCatching { httpConn?.disconnect() }
                }
                if (!measured) {
                    runCatching {
                        withConnection { c ->
                            val bi = c.openBi()
                            bi.send().writeAll((JSONObject().put("op", "bench").put("bytes", 4194304).toString() + "\n").toByteArray())
                            bi.send().finish()
                            val headerBuf = ByteArrayOutputStream(256)
                            var nl = -1
                            var headAll = ByteArray(0)
                            while (true) {
                                val got = bi.recv().read(CHUNK.toUInt())
                                if (got.isEmpty()) error("no answer")
                                val before = headerBuf.size()
                                headerBuf.write(got)
                                val rel = got.indexOf('\n'.code.toByte())
                                if (rel >= 0) {
                                    nl = before + rel
                                    headAll = headerBuf.toByteArray()
                                    break
                                }
                                if (headerBuf.size() > 16384) error("header too large")
                            }
                            val head = JSONObject(String(headAll, 0, nl, Charsets.UTF_8))
                            if (!head.optBoolean("ok", false)) error(head.optString("error", "bench failed"))
                            // timed from the answer's first bytes, over 4 MB (item 13)
                            val t0 = SystemClock.elapsedRealtime()
                            var totalBytes = 0L
                            while (true) {
                                val got = bi.recv().read(CHUNK.toUInt())
                                if (got.isEmpty()) break
                                totalBytes += got.size
                            }
                            val dtMs = (SystemClock.elapsedRealtime() - t0).coerceAtLeast(1L)
                            speedMbps = if (totalBytes > 0L) {
                                (totalBytes * 8.0) / (dtMs / 1000.0) / 1_000_000.0
                            } else 0.0
                        }
                    }
                }
            }
            res.put("speedMbps", Math.round(speedMbps * 10.0) / 10.0)
            call.resolve(res)
        }
    }

    /** §73.C4 — Explicitly saves a PC track for offline listening in noBackupFilesDir/link/offline. */
    @PluginMethod
    fun keepOffline(call: PluginCall) {
        val id = (call.getString("id", "") ?: "").removePrefix("pc_").removePrefix("pc:")
        if (!Regex("^[A-Za-z0-9_-]{1,64}$").matches(id) || !paired()) {
            call.reject("Invalid track id")
            return
        }
        scope.launch {
            val dest = File(offlineDir(), id)
            if (dest.exists()) {
                call.resolve(JSObject().put("ok", true).put("id", id))
                return@launch
            }
            val part = File(offlineDir(), "$id.part")
            runCatching {
                val lanStream = openLanSongStream(id, false, null, "$id-offline-dl")
                if (lanStream != null) {
                    lanStream.stream.use { input ->
                        FileOutputStream(part, false).use { out ->
                            input.copyTo(out, 65536)
                        }
                    }
                    if (lanStream.contentLength > 0L && part.length() != lanStream.contentLength) {
                        error("incomplete")
                    }
                    part.renameTo(dest)
                } else {
                    withConnection { c ->
                        val bi = c.openBi()
                        bi.send().writeAll((JSONObject().put("op", "song").put("id", id).put("from", 0).toString() + "\n").toByteArray())
                        bi.send().finish()
                        val headerBuf = ByteArrayOutputStream(512)
                        var nl = -1
                        var headAll = ByteArray(0)
                        while (true) {
                            val got = bi.recv().read(CHUNK.toUInt())
                            if (got.isEmpty()) error("no answer")
                            val before = headerBuf.size()
                            headerBuf.write(got)
                            val rel = got.indexOf('\n'.code.toByte())
                            if (rel >= 0) {
                                nl = before + rel
                                headAll = headerBuf.toByteArray()
                                break
                            }
                            if (headerBuf.size() > 64 * 1024) error("header too large")
                        }
                        val head = JSONObject(String(headAll, 0, nl, Charsets.UTF_8))
                        if (head.optBoolean("unpaired", false) || isUnpairedReason(head.optString("error", ""))) {
                            onPcMasterDisconnect()
                            error("removed")
                        }
                        if (!head.optBoolean("ok")) error(head.optString("error"))
                        FileOutputStream(part, false).use { out ->
                            out.write(headAll, nl + 1, headAll.size - nl - 1)
                            while (true) {
                                val got = bi.recv().read(CHUNK.toUInt())
                                if (got.isEmpty()) break
                                out.write(got)
                            }
                        }
                        if (part.length() != head.optLong("size")) error("incomplete")
                        part.renameTo(dest)
                    }
                }
                tracks = markOfflineFlags(tracks)
                saveTracksMetadata(tracks, libraryVersion)
                ShellHostPlugin.get()?.linkChanged()
                notifyListeners("changed", JSObject())
                call.resolve(JSObject().put("ok", true).put("id", id))
            }.onFailure {
                part.delete()
                call.resolve(JSObject().put("ok", false).put("error", it.message ?: "download failed"))
            }
        }
    }

    @PluginMethod
    fun removeOffline(call: PluginCall) {
        val id = (call.getString("id", "") ?: "").removePrefix("pc_").removePrefix("pc:")
        val removed = removeCachedTrack(id)
        call.resolve(JSObject().put("ok", removed))
    }

    /** Pairs from the PC's QR / iemdream://pair link. Resolves after the PC's owner answers. */
    @PluginMethod
    fun pair(call: PluginCall) {
        val uri = runCatching { Uri.parse(call.getString("link", "")) }.getOrNull()
        val ticket = uri?.getQueryParameter("t")
        val secret = uri?.getQueryParameter("s")
        if (uri?.scheme != "iemdream" || uri.host != "pair" || ticket.isNullOrEmpty() || secret.isNullOrEmpty()) {
            call.reject("That isn't a pairing code from the PC app")
            return
        }
        scope.launch {
            runCatching {
                withTimeout(PAIR_TIMEOUT_MS) {
                    val t0 = SystemClock.elapsedRealtime()
                    val c = endpoint().connect(EndpointTicket.fromString(ticket).endpointAddr(), ALPN)
                    val (head, _) = ask(c, withAbout(JSONObject().put("op", "pair").put("secret", secret)))
                    if (!head.optBoolean("ok")) {
                        c.close(0L, ByteArray(0))
                        return@withTimeout JSObject().put("ok", false).put("error", head.optString("error"))
                    }
                    lastLatencyMs = (SystemClock.elapsedRealtime() - t0).coerceAtLeast(1L)
                    val name = head.optString("name", uri.getQueryParameter("n") ?: "PC")
                    savePairedPc(ticket, name)
                    connLock.withLock { conn = c }
                    refused = false
                    libraryVersion = -1
                    scope.launch { pingAndSync() }
                    JSObject().put("ok", true).put("name", name)
                }
            }.onSuccess { call.resolve(it) }.onFailure {
                call.resolve(JSObject().put("ok", false).put("error", if (it is kotlinx.coroutines.TimeoutCancellationException) "timeout" else (it.message ?: "failed")))
            }
        }
    }

    /** Google's QR scanner (no camera permission needed: Play services shows its own screen). */
    @PluginMethod
    fun scan(call: PluginCall) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(activity, options).startScan()
            .addOnSuccessListener { call.resolve(JSObject().put("text", it.rawValue ?: "")) }
            .addOnCanceledListener { call.resolve(JSObject().put("text", "")) }
            .addOnFailureListener { call.reject(it.message ?: "The scanner couldn't start") }
    }

    @PluginMethod
    fun refresh(call: PluginCall) {
        scope.launch { refreshLibrary(); call.resolve(buildStatusJson()) }
    }

    /** §88 D: fetches the next song into the song cache ahead of time (drained through openSongStream's cache copy). */
    @PluginMethod
    fun prebuffer(call: PluginCall) {
        val rawId = call.getString("id", "") ?: ""
        val id = rawId.removePrefix("pc_").removePrefix("pc:")
        val lowData = call.getBoolean("lowData") ?: false
        if (id.isEmpty() || !paired()) {
            call.resolve()
            return
        }
        val cacheKey = if (lowData) "$id-low" else id
        if (cachedSongFile(cacheKey) != null || cacheKey in writing) {
            call.resolve()
            return
        }
        scope.launch {
            runCatching {
                songStream(id, lowData)?.second?.use { input ->
                    val b = ByteArray(64 * 1024)
                    while (input.read(b) >= 0) {
                        // every byte read is copied into the song cache on the way
                    }
                }
            }
            call.resolve()
        }
    }

    // ---- §88 B: the page's audio element streams PC songs over real HTTP from this phone itself. Through the WebView's
    // request hook its range answers were never accepted (it re-asked for the end of the file until it gave up). Only
    // 127.0.0.1, behind a random path made fresh each start, so other apps can't read through it.
    private val audioSecret = java.util.UUID.randomUUID().toString().replace("-", "")
    @Volatile private var audioServer: java.net.ServerSocket? = null

    @Synchronized
    private fun startAudioServer(): Int {
        audioServer?.takeIf { !it.isClosed }?.let { return it.localPort }
        val ss = java.net.ServerSocket(0, 16, java.net.InetAddress.getByName("127.0.0.1"))
        audioServer = ss
        Thread({
            while (!ss.isClosed) {
                val sock = try { ss.accept() } catch (e: Exception) { break }
                Thread({ runCatching { serveAudio(sock) } }, "avsb-audio").apply { isDaemon = true }.start()
            }
        }, "avsb-audio-accept").apply { isDaemon = true }.start()
        return ss.localPort
    }

    private fun serveAudio(sock: java.net.Socket) = sock.use { s ->
        s.soTimeout = 30_000
        val input = java.io.BufferedInputStream(s.getInputStream())
        val lines = ArrayList<String>()
        val line = StringBuilder()
        while (true) {
            val c = input.read()
            if (c < 0) return
            if (c == '\n'.code) {
                val text = line.toString().trimEnd('\r')
                line.setLength(0)
                if (text.isEmpty()) break
                lines.add(text)
                if (lines.size > 64) return
            } else {
                line.append(c.toChar())
                if (line.length > 8192) return
            }
        }
        val request = lines.firstOrNull()?.split(" ") ?: return
        val method = request[0]
        val path = request.getOrNull(1)?.substringBefore('?') ?: return
        val range = lines.drop(1).firstOrNull { it.startsWith("range:", ignoreCase = true) }?.substringAfter(':')?.trim()
        val out = java.io.BufferedOutputStream(s.getOutputStream(), CHUNK)
        fun head(status: String, headers: Map<String, String>) {
            val text = StringBuilder("HTTP/1.1 $status\r\n")
            for ((k, v) in headers) text.append(k).append(": ").append(v).append("\r\n")
            text.append("Access-Control-Allow-Origin: *\r\nCache-Control: private, max-age=86400\r\nConnection: close\r\n\r\n")
            out.write(text.toString().toByteArray())
        }
        val m = Regex("^/$audioSecret/(low|raw)/([A-Za-z0-9_-]{1,64})$").find(path)
        val res = m?.let { openSongStream(it.groupValues[2], it.groupValues[1] == "low", range) }
        if (res == null) {
            head("404 Not Found", mapOf("Content-Length" to "0"))
            out.flush()
            return
        }
        res.stream.use { body ->
            val headers = LinkedHashMap<String, String>()
            headers["Content-Type"] = res.mime
            if (res.contentLength > 0) headers["Content-Length"] = res.contentLength.toString()
            res.acceptRanges?.let { headers["Accept-Ranges"] = it }
            res.contentRange?.let { headers["Content-Range"] = it }
            head(if (res.status == 206) "206 Partial Content" else "200 OK", headers)
            if (method == "HEAD") {
                out.flush()
                return
            }
            val buf = ByteArray(CHUNK)
            while (true) {
                val n = body.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
            }
            out.flush()
        }
    }

    /** Where the page's audio element finds PC songs: `<base>/raw/<id>` or `<base>/low/<id>`. */
    @PluginMethod
    fun audioBase(call: PluginCall) {
        runCatching { startAudioServer() }.onSuccess { port ->
            val out = JSObject()
            out.put("base", "http://127.0.0.1:$port/$audioSecret")
            call.resolve(out)
        }.onFailure { call.reject(it.message ?: "no server") }
    }

    /** §88 C: how much the song cache holds, for Settings. */
    @PluginMethod
    fun songCache(call: PluginCall) {
        val songs = songCacheDir().listFiles { f -> !f.name.endsWith(".type") && !f.name.endsWith(".part") } ?: emptyArray()
        val out = JSObject()
        out.put("bytes", songs.sumOf { it.length() })
        out.put("songs", songs.size)
        call.resolve(out)
    }

    /** Empties the song cache (songs still downloading are left to finish). */
    @PluginMethod
    fun dropCachedSong(call: PluginCall) {
        val key = (call.getString("id") ?: "").removePrefix("pc_").removePrefix("pc:") + if (call.getBoolean("lowData") == true) "-low" else ""
        if (key.isNotEmpty() && key !in writing) {
            File(songCacheDir(), key).delete()
            File(songCacheDir(), "$key.type").delete()
        }
        call.resolve()
    }

    @PluginMethod
    fun clearSongCache(call: PluginCall) {
        val busy = HashSet(writing)
        songCacheDir().listFiles()?.forEach { f -> if (busy.none { f.name.startsWith(it) }) f.delete() }
        call.resolve()
    }

    /** Forgets the PC on this phone and empties the cache. (The PC drops this phone itself after 7 days unused.) */
    @PluginMethod
    fun forget(call: PluginCall) {
        scope.launch {
            connLock.withLock {
                runCatching { conn?.close(0L, ByteArray(0)) }
                conn = null
            }
            activeLanBase = null
            activeLanToken = null
            clearPairedPc()
            runCatching { songCacheDir().deleteRecursively() }
            tracks = JSONArray()
            libraryVersion = -1
            lastLatencyMs = -1L
            refused = false
            runCatching { coversDir().deleteRecursively() }
            runCatching { offlineDir().deleteRecursively() }
            runCatching { File(context.cacheDir, "link").deleteRecursively() }
            ShellHostPlugin.get()?.linkChanged()
            notifyListeners("changed", JSObject())
            call.resolve()
        }
    }
}
