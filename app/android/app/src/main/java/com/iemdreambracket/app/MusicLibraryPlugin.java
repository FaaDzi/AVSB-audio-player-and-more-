package com.iemdreambracket.app;

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The songs on the phone, like Samsung Music finds them: every audio file Android's media index
 * knows about (internal storage and SD card), at least MIN_MS long, with its tags and folder.
 * Nothing is copied; the page reads a song through its content:// URI when it plays it.
 * Needs "Music and audio" (READ_MEDIA_AUDIO, Android 13+) or storage (READ_EXTERNAL_STORAGE, older).
 */
@CapacitorPlugin(
    name = "MusicLibrary",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
    }
)
public class MusicLibraryPlugin extends Plugin {
    /** Shorter files are ringtones, notifications and voice clips, not songs (Samsung Music's default). */
    private static final long MIN_MS = 30_000;

    private static String alias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio" : "storage";
    }

    /** Is the permission granted already? Never asks. */
    @PluginMethod
    public void allowed(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", getPermissionState(alias()) == PermissionState.GRANTED);
        call.resolve(ret);
    }

    /** List the songs, asking for the permission first if needed. */
    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(alias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias(), call, "afterPermission");
            return;
        }
        scanNow(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) scanNow(call);
        else call.reject("permission denied", "DENIED");
    }

    private void scanNow(PluginCall call) {
        // off the main thread: a big library is thousands of rows
        new Thread(() -> {
            try {
                JSObject ret = new JSObject();
                ret.put("songs", query());
                call.resolve(ret);
            } catch (RuntimeException e) {
                call.reject("scan failed: " + e.getMessage());
            }
        }).start();
    }

    private JSArray query() {
        boolean q = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        Uri table = q ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] cols = q
            ? new String[] {
                MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.RELATIVE_PATH,
                MediaStore.Audio.Media.VOLUME_NAME,
            }
            : new String[] {
                MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.DATA,
            };
        JSArray out = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(
            table, cols, MediaStore.Audio.Media.DURATION + " >= ?", new String[] { String.valueOf(MIN_MS) }, null)) {
            if (c == null) return out;
            while (c.moveToNext()) {
                long id = c.getLong(0);
                String folder;
                String volume = "external_primary";
                if (q) {
                    folder = c.getString(8);
                    if (c.getString(9) != null) volume = c.getString(9);
                } else {
                    String data = c.getString(8);
                    folder = data == null ? "" : data.substring(0, data.lastIndexOf('/') + 1);
                }
                Uri uri = q
                    ? ContentUris.withAppendedId(MediaStore.Audio.Media.getContentUri(volume), id)
                    : ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
                JSObject s = new JSObject();
                s.put("id", id);
                s.put("uri", uri.toString());
                s.put("name", c.getString(1));
                s.put("title", c.getString(2));
                s.put("artist", c.getString(3));
                s.put("album", c.getString(4));
                s.put("duration", c.getLong(5) / 1000.0);
                s.put("size", c.getLong(6));
                s.put("added", c.getLong(7));
                s.put("folder", folder == null ? "" : folder);
                s.put("volume", volume);
                out.put(s);
            }
        }
        return out;
    }
}
