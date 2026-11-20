package com.iemdreambracket.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.util.Size;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The new UI's host on Android (plan §70 A2, §72.B3, §73.C): the same /shell-host/* routes the exe answers
 * (electron/shell-main.cjs), read from Android's media index instead of folders on disk. Nothing is copied: songs play
 * from their content:// URI, and PC tracks stream directly into RAM.
 *
 * GETs (library list, covers, audio, accent, trash-track) are answered in MainActivity's WebViewClient through
 * {@link #serve}; scan, folder management, and trashTrack also go through this plugin's methods.
 */
@CapacitorPlugin(
    name = "ShellHost",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
    }
)
public class ShellHostPlugin extends Plugin {
    /** Shorter files are ringtones, notifications and voice clips, not songs. */
    private static final long MIN_MS = 30_000;
    private static final String PREFS = "shell-host";
    private static final int TRASH_REQUEST_CODE = 7203;

    private static volatile ShellHostPlugin instance;
    private final Object lock = new Object();
    private JSONArray tracks = new JSONArray();
    /** Track id → content URI, for /shell-host/audio, covers, and trashTrack. Only songs from the media index can be served. */
    private final Map<String, Uri> uris = new HashMap<>();
    private final Map<String, Long> albumIds = new HashMap<>();
    private final Map<String, Long> scanTimes = new HashMap<>();
    private final Map<String, Integer> folderCounts = new LinkedHashMap<>();
    /** Files left out under each hidden folder, top or deeper. */
    private final Map<String, Integer> hiddenCounts = new HashMap<>();
    private volatile boolean scanning = false;
    private int version = 0;
    private PowerManager.WakeLock namingWakeLock;

    @Override
    public void load() {
        instance = this;
        if (granted()) {
            scanning = true;
            new Thread(this::scanNow).start();
        }
    }

    static ShellHostPlugin get() {
        return instance;
    }

    private static String alias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio" : "storage";
    }

    private boolean granted() {
        return getPermissionState(alias()) == PermissionState.GRANTED;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Top folders that start hidden on the first scan: voice recordings, system sounds and apps' own media (messenger
     * voice notes live under Android/). They're listed under Hidden folders with Add back, never deleted.
     */
    private static final String[] HIDDEN_AT_FIRST = { "Recordings/", "Notifications/", "Ringtones/", "Alarms/", "Android/", "MIUI/", "Call/", "Sounds/" };

    private Set<String> hidden() {
        Set<String> hide = new HashSet<>(prefs().getStringSet("hidden", new HashSet<>()));
        // once per install, added to whatever is hidden already; Add back sticks after that
        if (!prefs().getBoolean("hiddenDefaults", false)) {
            hide.addAll(java.util.Arrays.asList(HIDDEN_AT_FIRST));
            prefs().edit().putStringSet("hidden", hide).putBoolean("hiddenDefaults", true).apply();
        }
        return hide;
    }

    // ---- plugin methods: scan, folder list, resync, and recoverable trash

    @PluginMethod
    public void scan(PluginCall call) {
        if (!granted()) {
            requestPermissionForAlias(alias(), call, "afterPermission");
            return;
        }
        startScan(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (granted()) startScan(call);
        else call.reject("Music and audio access was not allowed", "DENIED");
    }

    private void startScan(PluginCall call) {
        // marked before the thread starts, so the page's next read already sees the scan and keeps polling
        scanning = true;
        new Thread(this::scanNow).start();
        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    /** Replaces the folder list: top folders missing from it become hidden, ones on it are shown again. */
    @PluginMethod
    public void setFolders(PluginCall call) {
        JSArray list = call.getArray("folders", new JSArray());
        Set<String> keep = new HashSet<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject f = list.optJSONObject(i);
            if (f != null) keep.add(f.optString("path"));
        }
        Set<String> hide = hidden();
        synchronized (lock) {
            for (String root : folderCounts.keySet()) {
                if (keep.contains(root)) hide.remove(root);
                else hide.add(root);
            }
        }
        // a path not seen in the index yet (typed by hand) is shown again if it was hidden
        hide.removeAll(keep);
        prefs().edit().putStringSet("hidden", hide).apply();
        scanning = true;
        new Thread(this::scanNow).start();
        JSObject ret = new JSObject();
        ret.put("folders", foldersJson());
        call.resolve(ret);
    }

    /** Hides one folder at any depth ("Music/Calls/"), or shows it again. Its subfolders follow it. */
    @PluginMethod
    public void hideFolder(PluginCall call) {
        String path = call.getString("path", "");
        if (path.startsWith("/")) path = path.substring(1);
        if (!path.isEmpty() && !path.endsWith("/")) path += "/";
        if (path.isEmpty()) {
            call.reject("No folder given");
            return;
        }
        Set<String> hide = hidden();
        if (call.getBoolean("hidden", true)) hide.add(path);
        else hide.remove(path);
        prefs().edit().putStringSet("hidden", hide).apply();
        scanning = true;
        new Thread(this::scanNow).start();
        call.resolve();
    }

    /** §73.C3 — Forwards resync/ping to LinkPlugin if available. */
    @PluginMethod
    public void resync(PluginCall call) {
        LinkPlugin link = LinkPlugin.Companion.getInstance();
        if (link != null) {
            link.resync(call);
        } else {
            call.resolve(new JSObject().put("paired", false).put("connected", false));
        }
    }

    @PluginMethod
    public void ping(PluginCall call) {
        resync(call);
    }

    /** Background metadata runner keep-awake: keeps CPU running when phone is minimized or screen off (§72.A5). */
    @PluginMethod
    public void setWakeLock(PluginCall call) {
        boolean enable = call.getBoolean("enabled", false);
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                if (enable) {
                    if (namingWakeLock == null) {
                        namingWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "avsb:naming-runner");
                        namingWakeLock.setReferenceCounted(false);
                    }
                    if (!namingWakeLock.isHeld()) {
                        namingWakeLock.acquire(45 * 60 * 1000L); // 45 min max safety window
                    }
                } else {
                    if (namingWakeLock != null && namingWakeLock.isHeld()) {
                        namingWakeLock.release();
                    }
                }
            }
            call.resolve(new JSObject().put("active", enable));
        } catch (Exception e) {
            call.reject("WakeLock failed: " + e.getMessage());
        }
    }

    /**
     * §72.B3 & §72.B5 — Moves a phone song to the system Trash using MediaStore.createTrashRequest (Android 11+),
     * or removes a PC song from the phone's cache.
     */
    @PluginMethod
    public void trashTrack(PluginCall call) {
        String id = call.getString("id", "");
        String path = call.getString("path", "");
        JSObject res = performTrashTrack(id, path);
        call.resolve(res);
    }

    private JSObject performTrashTrack(String id, String path) {
        JSObject res = new JSObject();
        String target = (id != null && !id.isEmpty()) ? id : (path != null ? path : "");
        if (target.isEmpty()) {
            res.put("ok", false);
            res.put("error", "no track specified");
            return res;
        }
        // §72.B5: PC songs cannot be deleted on the PC from the phone; only removed from this phone's cache
        if (target.startsWith("pc_") || target.startsWith("pc:") || (path != null && path.startsWith("pc:"))) {
            LinkPlugin link = LinkPlugin.Companion.getInstance();
            String rawId = !id.isEmpty() ? id : path;
            boolean removed = link != null && link.removeCachedTrack(rawId);
            res.put("ok", true);
            res.put("cachedOnly", true);
            res.put("removed", removed);
            return res;
        }

        Uri uri = null;
        String matchedKey = null;
        synchronized (lock) {
            if (id != null && uris.containsKey(id)) {
                uri = uris.get(id);
                matchedKey = id;
            } else if (path != null && !path.isEmpty()) {
                for (Map.Entry<String, Uri> e : uris.entrySet()) {
                    if (e.getValue().toString().equals(path)) {
                        uri = e.getValue();
                        matchedKey = e.getKey();
                        break;
                    }
                }
            }
        }
        if (uri == null) {
            res.put("ok", false);
            res.put("error", "not found");
            return res;
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                List<Uri> list = Collections.singletonList(uri);
                PendingIntent pi = MediaStore.createTrashRequest(getContext().getContentResolver(), list, true);
                if (getActivity() != null) {
                    getActivity().startIntentSenderForResult(pi.getIntentSender(), TRASH_REQUEST_CODE, null, 0, 0, 0, null);
                }
                removeTrackFromMemory(matchedKey);
                // Re-scan after user responds to the system Trash confirmation dialog
                new Thread(() -> {
                    try {
                        Thread.sleep(2500);
                        scanNow();
                    } catch (InterruptedException ignored) {
                    }
                }).start();
                res.put("ok", true);
                res.put("trashed", true);
                return res;
            } else {
                int deleted = getContext().getContentResolver().delete(uri, null, null);
                if (deleted > 0) {
                    removeTrackFromMemory(matchedKey);
                    new Thread(this::scanNow).start();
                    res.put("ok", true);
                    res.put("trashed", true);
                } else {
                    res.put("ok", false);
                    res.put("error", "could not delete");
                }
                return res;
            }
        } catch (Exception e) {
            res.put("ok", false);
            res.put("error", e.getMessage() != null ? e.getMessage() : "trash failed");
            return res;
        }
    }

    private void removeTrackFromMemory(String key) {
        if (key == null) return;
        synchronized (lock) {
            uris.remove(key);
            JSONArray kept = new JSONArray();
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject t = tracks.optJSONObject(i);
                if (t != null && !key.equals(t.optString("id"))) {
                    kept.put(t);
                }
            }
            tracks = kept;
            version++;
        }
    }

    /** The hidden folder a song's folder falls under, or null. */
    static String hiddenBy(String relative, Set<String> hide) {
        String best = null;
        for (String h : hide) {
            if (relative.startsWith(h) && (best == null || h.length() < best.length())) best = h;
        }
        return best;
    }

    // ---- the scan

    private void scanNow() {
        if (!granted()) return;
        scanning = true;
        bump();
        try {
            Set<String> hide = hidden();
            JSONArray out = new JSONArray();
            Map<String, Uri> found = new HashMap<>();
            Map<String, Long> foundAlbums = new HashMap<>();
            Map<String, Integer> counts = new LinkedHashMap<>();
            Map<String, Integer> hiddenFound = new HashMap<>();
            query(out, found, foundAlbums, counts, hide, hiddenFound);
            synchronized (lock) {
                tracks = out;
                uris.clear();
                uris.putAll(found);
                albumIds.clear();
                albumIds.putAll(foundAlbums);
                folderCounts.clear();
                folderCounts.putAll(counts);
                hiddenCounts.clear();
                hiddenCounts.putAll(hiddenFound);
                long now = System.currentTimeMillis();
                for (String root : counts.keySet()) scanTimes.put(root, now);
            }
        } catch (RuntimeException e) {
            android.util.Log.w("ShellHost", "scan failed", e);
        } finally {
            scanning = false;
            bump();
        }
    }

    /** The PC link's song list changed (LinkPlugin): the page re-reads the library. */
    void linkChanged() {
        bump();
        try {
            notifyListeners("changed", new com.getcapacitor.JSObject());
        } catch (Exception ignored) {}
    }

    private void bump() {
        synchronized (lock) {
            version++;
        }
    }

    /** "Music/Albums/X/" → "Music/". Songs at the top of the storage go under "/". */
    static String topFolder(String relative) {
        if (relative == null || relative.isEmpty()) return "/";
        int slash = relative.indexOf('/');
        return slash < 0 ? relative + "/" : relative.substring(0, slash + 1);
    }

    private static String col(Cursor c, String name) {
        int i = c.getColumnIndex(name);
        return i < 0 || c.isNull(i) ? "" : c.getString(i);
    }

    private static long num(Cursor c, String name) {
        int i = c.getColumnIndex(name);
        return i < 0 || c.isNull(i) ? 0 : c.getLong(i);
    }

    private void query(JSONArray out, Map<String, Uri> found, Map<String, Long> foundAlbums, Map<String, Integer> counts, Set<String> hide, Map<String, Integer> hiddenFound) {
        boolean q = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        Uri table = q ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        ContentResolver cr = getContext().getContentResolver();
        try (Cursor c = cr.query(table, null, MediaStore.Audio.Media.DURATION + " >= ?", new String[] { String.valueOf(MIN_MS) }, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                long id = num(c, MediaStore.Audio.Media._ID);
                String volume = q ? col(c, MediaStore.Audio.Media.VOLUME_NAME) : "";
                if (volume.isEmpty()) volume = "external_primary";
                String relative;
                if (q) relative = col(c, MediaStore.Audio.Media.RELATIVE_PATH);
                else {
                    String data = col(c, MediaStore.Audio.Media.DATA);
                    int at = data.indexOf("/0/");
                    String rest = at >= 0 ? data.substring(at + 3) : data;
                    relative = rest.contains("/") ? rest.substring(0, rest.lastIndexOf('/') + 1) : "";
                }
                String root = topFolder(relative);
                String by = hiddenBy(relative == null ? "" : relative, hide);
                if (by == null && hide.contains(root)) by = root;
                if (by != null) {
                    hiddenFound.put(by, (hiddenFound.containsKey(by) ? hiddenFound.get(by) : 0) + 1);
                    // a whole top folder hidden leaves the folder list; a deeper one only takes its songs out
                    if (!by.equals(root)) counts.put(root, counts.containsKey(root) ? counts.get(root) : 0);
                    else counts.put(root, (counts.containsKey(root) ? counts.get(root) : 0) + 1);
                    continue;
                }
                counts.put(root, (counts.containsKey(root) ? counts.get(root) : 0) + 1);
                Uri uri = q
                    ? ContentUris.withAppendedId(MediaStore.Audio.Media.getContentUri(volume), id)
                    : ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
                String key = "a" + id;
                found.put(key, uri);
                String name = col(c, MediaStore.Audio.Media.DISPLAY_NAME);
                String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
                String album = col(c, MediaStore.Audio.Media.ALBUM);
                // with no album tag Android fills in the folder's name ("the music"): that isn't an album
                String folderName = relative == null ? "" : relative.replaceAll("/+$", "");
                folderName = folderName.contains("/") ? folderName.substring(folderName.lastIndexOf('/') + 1) : folderName;
                if (album.equalsIgnoreCase(folderName)) album = "";
                String artist = unknown(col(c, MediaStore.Audio.Media.ARTIST));
                String albumArtist = col(c, "album_artist");
                long albumId = num(c, MediaStore.Audio.Media.ALBUM_ID);
                foundAlbums.put(key, albumId);
                String cover = key;
                long sec = num(c, MediaStore.Audio.Media.DURATION) / 1000;
                long size = num(c, MediaStore.Audio.Media.SIZE);
                long kbps = num(c, "bitrate") / 1000;
                if (kbps == 0 && sec > 0) kbps = size * 8 / 1000 / sec;
                int track = (int) num(c, MediaStore.Audio.Media.TRACK);
                try {
                    JSONObject t = new JSONObject();
                    t.put("id", key);
                    t.put("path", uri.toString());
                    t.put("folder", "/" + relative);
                    t.put("root", root);
                    t.put("playable", playable(ext));
                    t.put("title", col(c, MediaStore.Audio.Media.TITLE).isEmpty() ? name : col(c, MediaStore.Audio.Media.TITLE));
                    t.put("artist", artist);
                    t.put("albumArtist", albumArtist.isEmpty() ? artist : albumArtist);
                    t.put("album", album);
                    // MediaStore packs disc into the thousands: 2005 = disc 2, track 5
                    t.put("track", track % 1000);
                    t.put("trackTotal", 0);
                    t.put("disc", track >= 1000 ? track / 1000 : 1);
                    long year = num(c, MediaStore.Audio.Media.YEAR);
                    t.put("date", year > 0 ? String.valueOf(year) : "");
                    t.put("year", year);
                    t.put("genre", col(c, "genre"));
                    t.put("label", "");
                    t.put("composer", col(c, MediaStore.Audio.Media.COMPOSER));
                    t.put("isrc", "");
                    t.put("isrcOk", false);
                    t.put("lyrics", false);
                    t.put("replayGain", false);
                    t.put("downloaded", false);
                    t.put("format", ext.toUpperCase(Locale.ROOT));
                    t.put("lossy", !(ext.equals("flac") || ext.equals("wav") || ext.equals("aiff") || ext.equals("aif") || ext.equals("ape") || ext.equals("wv")));
                    t.put("bits", num(c, "bits_per_sample"));
                    t.put("rate", num(c, "samplerate"));
                    t.put("sec", sec);
                    t.put("size", size);
                    t.put("kbps", kbps);
                    t.put("added", num(c, MediaStore.Audio.Media.DATE_ADDED)); // seconds, like the PC's (plan §91 A)
                    t.put("cover", q ? cover : "");
                    out.put(t);
                } catch (org.json.JSONException ignored) {
                    // a value JSON can't hold (NaN): leave that song out
                }
            }
        }
    }

    private static String unknown(String artist) {
        return "<unknown>".equals(artist) ? "" : artist;
    }

    /** What Android's WebView decodes. ALAC in .m4a is let through and fails at play time like on PC. */
    private static boolean playable(String ext) {
        switch (ext) {
            case "flac": case "mp3": case "m4a": case "aac": case "mp4": case "opus": case "ogg": case "oga": case "wav":
                return true;
            default:
                return false;
        }
    }

    private JSONArray foldersJson() {
        JSONArray out = new JSONArray();
        Set<String> hide = hidden();
        synchronized (lock) {
            for (Map.Entry<String, Integer> e : folderCounts.entrySet()) {
                if (hide.contains(e.getKey())) continue;
                try {
                    JSONObject f = new JSONObject();
                    f.put("path", e.getKey());
                    f.put("subfolders", true);
                    Long at = scanTimes.get(e.getKey());
                    f.put("lastScan", at == null ? 0 : at);
                    f.put("online", true);
                    f.put("count", e.getValue());
                    out.put(f);
                } catch (org.json.JSONException ignored) {
                }
            }
        }
        return out;
    }

    /** Hidden top folders that have songs, with their counts, for Settings → Local Library's Add back. */
    private JSONArray hiddenJson() {
        JSONArray out = new JSONArray();
        Set<String> hide = hidden();
        synchronized (lock) {
            for (Map.Entry<String, Integer> e : hiddenCounts.entrySet()) {
                if (!hide.contains(e.getKey())) continue;
                try {
                    JSONObject f = new JSONObject();
                    f.put("path", e.getKey());
                    f.put("count", e.getValue());
                    out.put(f);
                } catch (org.json.JSONException ignored) {
                }
            }
        }
        return out;
    }

    private String stateJson() {
        try {
            JSONObject s = new JSONObject();
            synchronized (lock) {
                // the phone's own songs, then the paired PC's (plan §70 D3), all one list for the page
                JSONArray all = new JSONArray();
                for (int i = 0; i < tracks.length(); i++) all.put(tracks.get(i));
                LinkPlugin link = LinkPlugin.Companion.getInstance();
                if (link != null) {
                    JSONArray pc = link.libraryTracks();
                    for (int i = 0; i < pc.length(); i++) all.put(pc.get(i));
                }
                s.put("tracks", all);
                s.put("version", version);
            }
            s.put("folders", foldersJson());
            s.put("hidden", hiddenJson());
            if (scanning) {
                JSONObject sc = new JSONObject();
                sc.put("found", 0);
                sc.put("read", 0);
                sc.put("folder", "This phone");
                s.put("scanning", sc);
            } else s.put("scanning", JSONObject.NULL);
            return s.toString();
        } catch (org.json.JSONException e) {
            return "{\"folders\":[],\"tracks\":[],\"scanning\":null,\"version\":0}";
        }
    }

    // ---- GET routes, called from MainActivity's WebViewClient (any thread)

    /** The answer for a /shell-host/* request, or null to let Capacitor serve the app's own files. */
    WebResourceResponse serve(WebResourceRequest req) {
        Uri url = req.getUrl();
        String path = url.getPath();
        if (path != null && path.startsWith("/kuromoji-dict/") && path.endsWith(".dat.gz")) return kuromojiDict(path);
        if (path == null || !path.startsWith("/shell-host/")) return null;
        switch (path) {
            case "/shell-host/library":
                return text(200, "application/json", stateJson());
            case "/shell-host/cover":
                return cover(url.getQueryParameter("id"));
            case "/shell-host/audio": {
                String rangeHeader = req.getRequestHeaders() != null ? req.getRequestHeaders().get("Range") : null;
                return audio(url.getQueryParameter("path"), "1".equals(url.getQueryParameter("lowdata")), rangeHeader);
            }
            case "/shell-host/accent":
                return text(200, "application/json", accentJson());
            case "/shell-host/meta":
                return meta(url.getQueryParameter("url"));
            case "/shell-host/trash-track": {
                JSObject res = performTrashTrack(url.getQueryParameter("id"), url.getQueryParameter("path"));
                int code = res.optBoolean("ok", false) ? 200 : 404;
                return text(code, "application/json", res.toString());
            }
            default:
                // lyrics, motion covers and online lookups aren't on Android yet
                return text(404, "text/plain", "not found");
        }
    }

    private static WebResourceResponse text(int status, String type, String body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(type, "utf-8", status, status == 200 ? "OK" : "Not Found", headers,
            new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    /** Only URIs from the scan (or streamed PC tracks) are served, so the page can't name another file. */
    private WebResourceResponse audio(String wanted) {
        return audio(wanted, false);
    }

    /** The content URI of a song in the media index, or null; Direct to DAC (DirectDacPlugin) plays only these. */
    Uri indexedUri(String wanted) {
        synchronized (lock) {
            for (Uri u : uris.values()) if (u.toString().equals(wanted)) return u;
        }
        return null;
    }

    private WebResourceResponse audio(String wanted, boolean lowData) {
        return audio(wanted, lowData, null);
    }

    private WebResourceResponse audio(String wanted, boolean lowData, String rangeHeader) {
        // §73.C1: a song on the paired PC streams via direct LAN HTTP or iroh QUIC (bounded RAM LRU, 0 MB flash storage used)
        if (wanted != null && wanted.startsWith("pc:")) {
            LinkPlugin link = LinkPlugin.Companion.getInstance();
            LinkPlugin.SongStreamResult result = link == null ? null : link.openSongStream(wanted.substring(3), lowData, rangeHeader);
            if (result == null) return text(404, "text/plain", "not found");
            Map<String, String> headers = new HashMap<>();
            // §88 B: the WebView's audio element reads a song in ranges and joins them; a "no-store" answer can't be joined,
            // so it re-asked for the end of the file forever. The song's bytes never change under the same id.
            headers.put("Cache-Control", "private, max-age=86400");
            if (result.getAcceptRanges() != null) headers.put("Accept-Ranges", result.getAcceptRanges());
            if (result.getContentRange() != null) headers.put("Content-Range", result.getContentRange());
            if (result.getContentLength() > 0L) headers.put("Content-Length", String.valueOf(result.getContentLength()));
            int status = result.getStatus();
            String reason = status == 206 ? "Partial Content" : "OK";
            return new WebResourceResponse(result.getMime(), null, status, reason, headers, result.getStream());
        }
        Uri uri = null;
        synchronized (lock) {
            for (Uri u : uris.values()) {
                if (u.toString().equals(wanted)) {
                    uri = u;
                    break;
                }
            }
        }
        if (uri == null) return text(404, "text/plain", "not found");
        try {
            InputStream in = getContext().getContentResolver().openInputStream(uri);
            if (in == null) return text(404, "text/plain", "not found");
            String type = getContext().getContentResolver().getType(uri);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(type == null ? "application/octet-stream" : type, null, 200, "OK", headers, in);
        } catch (Exception e) {
            return text(404, "text/plain", "not found");
        }
    }

    /** The album art Android extracted, kept as a 640 px JPEG in noBackupFilesDir so system cache cleaners leave it intact. */
    private static WebResourceResponse fileResponse(File file, String type, String cache) {
        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", cache);
            return new WebResourceResponse(type, null, 200, "OK", headers, new FileInputStream(file));
        } catch (Exception e) {
            return text(404, "text/plain", "not found");
        }
    }

    private final java.util.concurrent.ConcurrentHashMap<String, Object> coverGenLocks = new java.util.concurrent.ConcurrentHashMap<>();

    private Bitmap loadTrackOrAlbumBitmap(Uri uri, Long albumId) {
        try {
            return getContext().getContentResolver().loadThumbnail(uri, new Size(640, 640), null);
        } catch (Exception ignored) {
        }
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(getContext(), uri);
            byte[] pic = mmr.getEmbeddedPicture();
            if (pic != null && pic.length > 0) {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(pic, 0, pic.length, bounds);
                int maxDim = Math.max(bounds.outWidth, bounds.outHeight);
                int sample = 1;
                if (maxDim > 640) {
                    while ((maxDim / sample) > 640) sample *= 2;
                }
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = sample;
                opts.inPreferredConfig = Bitmap.Config.RGB_565;
                Bitmap b = BitmapFactory.decodeByteArray(pic, 0, pic.length, opts);
                if (b != null) return b;
            }
        } catch (Throwable ignored) {
        } finally {
            try { mmr.release(); } catch (Exception ignored) {}
        }
        if (albumId != null && albumId > 0) {
            try {
                Uri albumUri = ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, albumId);
                return getContext().getContentResolver().loadThumbnail(albumUri, new Size(640, 640), null);
            } catch (Exception ignored) {
            }
        }
        return null;
    }

    private WebResourceResponse cover(String id) {
        if (id != null && id.startsWith("pc_")) {
            LinkPlugin link = LinkPlugin.Companion.getInstance();
            File file = link == null ? null : link.coverFile(id.substring(3));
            return file == null ? text(404, "text/plain", "not found") : fileResponse(file, "image/jpeg", "max-age=31536000");
        }
        if (id == null || !id.matches("a\\d+") || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return text(404, "text/plain", "not found");
        Uri uri;
        Long albumId;
        synchronized (lock) {
            uri = uris.get(id);
            albumId = albumIds.get(id);
        }
        if (uri == null) return text(404, "text/plain", "not found");
        File dir = new File(getContext().getNoBackupFilesDir(), "covers");
        File file = new File(dir, id + ".jpg");
        try {
            if (!file.exists()) {
                Object genLock = coverGenLocks.computeIfAbsent(id, k -> new Object());
                try {
                    synchronized (genLock) {
                        if (!file.exists()) {
                            Bitmap art = loadTrackOrAlbumBitmap(uri, albumId);
                            if (art == null) return text(404, "text/plain", "not found");
                            try {
                                //noinspection ResultOfMethodCallIgnored
                                dir.mkdirs();
                                File tmp = new File(dir, id + ".jpg.tmp");
                                try (FileOutputStream os = new FileOutputStream(tmp)) {
                                    art.compress(Bitmap.CompressFormat.JPEG, 85, os);
                                }
                                if (!tmp.renameTo(file) && !file.exists()) {
                                    //noinspection ResultOfMethodCallIgnored
                                    tmp.delete();
                                }
                            } finally {
                                art.recycle();
                            }
                        }
                    }
                } finally {
                    coverGenLocks.remove(id, genLock);
                }
            }
            if (!file.exists()) return text(404, "text/plain", "not found");
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "max-age=31536000");
            return new WebResourceResponse("image/jpeg", null, 200, "OK", headers, new FileInputStream(file));
        } catch (Exception e) {
            return text(404, "text/plain", "not found");
        }
    }

    /**
     * Song details lookup (Settings → Metadata, the Song page): the same allow-list and User-Agent as the exe
     * (electron/meta-proxy.cjs). Only these addresses are ever fetched; MusicBrainz asks callers to name themselves.
     */
    private static final String[] META_ALLOWED = {
        "https://musicbrainz.org/ws/2/",
        "https://coverartarchive.org/release/",
        "https://coverartarchive.org/release-group/",
        "https://api.deezer.com/",
        "https://cdn-images.dzcdn.net/images/cover/",
        "https://cdn-images.dzcdn.net/images/artist/",
        "https://e-cdns-images.dzcdn.net/images/artist/",
        "https://e-cdns-images.dzcdn.net/images/cover/",
        "https://itunes.apple.com/search",
        "https://is1-ssl.mzstatic.com/",
        "https://is2-ssl.mzstatic.com/",
        "https://is3-ssl.mzstatic.com/",
        "https://is4-ssl.mzstatic.com/",
        "https://is5-ssl.mzstatic.com/",
    };
    private static final int META_MAX_BYTES = 8_000_000;

    private WebResourceResponse meta(String wanted) {
        if (wanted == null || !wanted.startsWith("https://")) return text(404, "text/plain", "not found");
        boolean ok = false;
        for (String a : META_ALLOWED) if (wanted.startsWith(a)) ok = true;
        if (!ok) return text(404, "text/plain", "not found");
        try {
            java.net.URL target = new java.net.URL(wanted);
            for (int hop = 0; hop < 5; hop++) {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) target.openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(20000);
                c.setRequestProperty("User-Agent", "AVSB/1.1.4 ( https://github.com/FaaDzi/AVSB-audio-player-and-more- )");
                c.setRequestProperty("Accept", "application/json, image/*");
                int status = c.getResponseCode();
                if (status >= 300 && status < 400 && c.getHeaderField("Location") != null) {
                    // Cover Art Archive redirects to archive.org for the image itself; only https is followed
                    target = new java.net.URL(target, c.getHeaderField("Location"));
                    c.disconnect();
                    if (!"https".equals(target.getProtocol())) return text(404, "text/plain", "not found");
                    continue;
                }
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                java.io.ByteArrayOutputStream body = new java.io.ByteArrayOutputStream();
                if (in != null) {
                    byte[] buf = new byte[65536];
                    for (int n; (n = in.read(buf)) > 0; ) {
                        body.write(buf, 0, n);
                        if (body.size() > META_MAX_BYTES) return text(502, "text/plain", "too large");
                    }
                    in.close();
                }
                String type = c.getContentType() == null ? "application/octet-stream" : c.getContentType().split(";")[0];
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                return new WebResourceResponse(type, "utf-8", status, status < 400 ? "OK" : "Error", headers, new ByteArrayInputStream(body.toByteArray()));
            }
            return text(502, "text/plain", "too many redirects");
        } catch (Exception e) {
            return text(502, "text/plain", "lookup failed");
        }
    }

    /** Material You's accent (Android 12+), for Dynamic Color. */
    private String accentJson() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return "{}";
        int c = getContext().getColor(android.R.color.system_accent1_500);
        return String.format(Locale.ROOT, "{\"accent\":\"#%06x\"}", c & 0xffffff);
    }

    /**
     * The page's theme for the system bars: { darkIcons, bgColor "#rrggbb" }. Icons and the window colour behind the
     * page change together, so a theme switch never shows white icons on a light strip (or the reverse).
     */
    @PluginMethod
    public void setSystemAppearance(PluginCall call) {
        boolean darkIcons = Boolean.TRUE.equals(call.getBoolean("darkIcons", false));
        String bg = call.getString("bgColor");
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                android.view.Window w = getActivity().getWindow();
                if (bg != null && bg.matches("#[0-9a-fA-F]{6}")) w.getDecorView().setBackgroundColor(android.graphics.Color.parseColor(bg));
                androidx.core.view.WindowInsetsControllerCompat bars = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
                bars.setAppearanceLightStatusBars(darkIcons);
                bars.setAppearanceLightNavigationBars(darkIcons);
            } catch (Throwable ignored) {}
            call.resolve();
        });
    }

    /**
     * Japanese lyrics' romaji dictionary (romaji.ts). The Android build unzips .gz assets and drops the extension, so
     * kuromoji's requests for name.dat.gz found nothing and romaji never loaded on the phone (plan §76 J). The build
     * ships them as name.dat.gzip, which it leaves alone, and they are served here unchanged under the asked-for name.
     */
    private WebResourceResponse kuromojiDict(String path) {
        String name = path.substring(path.lastIndexOf('/') + 1);
        if (!name.matches("[a-z_]+\\.dat\\.gz")) return null;
        try {
            InputStream in = getContext().getAssets().open("public/kuromoji-dict/" + name + "ip");
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "max-age=31536000");
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, in);
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void moveToBackground(PluginCall call) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().moveTaskToBack(true);
                } catch (Throwable ignored) {}
            });
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (namingWakeLock != null && namingWakeLock.isHeld()) {
            try { namingWakeLock.release(); } catch (Exception ignored) {}
        }
        super.handleOnDestroy();
    }
}
