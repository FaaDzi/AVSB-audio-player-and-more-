package com.iemdreambracket.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Background music (src/platform.ts): while a song plays, a foreground media service keeps the
 * app alive with the screen off or on Home, and the app holds audio focus. When another app takes
 * focus (YouTube, Instagram, a music player, a call) or the earphones are unplugged, it sends
 * "focusLost" and the page pauses; it never resumes on its own.
 *
 * The gallery also fills a media session (setNowPlaying): title, artist and cover on the
 * notification and lock screen, with ⏮ ⏯ ⏭ and a seek bar, which also makes Bluetooth and
 * earphone buttons and watches work. Those send "control" events back to the page.
 *
 * Bluetooth buds that drop out (a crowd, a pocket) pause the music like an unplug, but if the
 * same buds are back within RESUME_WINDOW_MS and media is really going to them again, it resumes
 * with a fade-in. Any press of yours, a call or another app playing calls that off. The service
 * stays up for the window so Android doesn't freeze the app before the buds return.
 */
@CapacitorPlugin(name = "MediaPlayback")
public class MediaPlaybackPlugin extends Plugin {
    static final String CHANNEL = "playback";
    static final int NOTIFICATION_ID = 1;
    private static final String ACTION_PREV = "com.iemdreambracket.app.PREV";
    private static final String ACTION_TOGGLE = "com.iemdreambracket.app.TOGGLE";
    private static final String ACTION_NEXT = "com.iemdreambracket.app.NEXT";

    /** The live plugin, for the service to build its notification from. */
    static MediaPlaybackPlugin instance;

    private AudioFocusRequest focusRequest;
    private boolean holding;
    private boolean noisyRegistered;
    private MediaSession session;
    /** What the gallery is playing; null title = nothing set (a match, or the gallery is closed). */
    private String title;
    private String artist;
    private Bitmap art;
    private boolean playing;

    /** Bluetooth drop → resume (see the class note). */
    static final long RESUME_WINDOW_MS = 30_000;
    /** Wait after the buds are back before resuming, so the route has really moved to them. */
    private static final long RESUME_SETTLE_MS = 800;
    private static final float RESUME_FADE_S = 1f;
    private final Handler main = new Handler(Looper.getMainLooper());
    /** A drop paused the music and it may resume until `resumeUntil`; `droppedName` = the buds that went. */
    private boolean resumePending;
    private String droppedName;
    private long resumeUntil;
    /**
     * Paused with a song set, the service stays up (so swiping the app away still reaches onTaskRemoved and clears the
     * notification; the old way stopped it on pause and the notification outlived the app). After this long paused it
     * goes, notification and all.
     */
    static final long PAUSED_KEEP_MS = 10 * 60_000;
    private final Runnable pausedTimeout = () -> {
        if (playing) return;
        MediaPlaybackService.updateLocks(getContext(), false);
        getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
        if (session != null) session.setActive(false);
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
    };
    private final Runnable endWindow = () -> {
        cancelResume();
        if (!holding) getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
    };

    private final AudioDeviceCallback onDevices = new AudioDeviceCallback() {
        @Override
        public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            if (!resumePending) return;
            for (AudioDeviceInfo d : removed) {
                if (isBluetooth(d.getType())) {
                    if (droppedName == null) droppedName = nameOf(d);
                } else if (AudioRoutePlugin.isExternal(d.getType())) {
                    cancelResume(); // wired earphones unplugged on purpose: that stays paused
                }
            }
        }

        @Override
        public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
            if (!resumePending || droppedName == null || SystemClock.elapsedRealtime() > resumeUntil) return;
            for (AudioDeviceInfo d : added) {
                if (!isBluetooth(d.getType()) || !droppedName.equals(nameOf(d))) continue;
                main.postDelayed(MediaPlaybackPlugin.this::resumeIfBack, RESUME_SETTLE_MS);
                return;
            }
        }
    };

    private final AudioManager.OnAudioFocusChangeListener onFocus = (change) -> {
        // a short notification ping ducks (transient may-duck) and is left alone
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            notifyListeners("focusLost", null);
            release();
        }
    };

    /** Earphones unplugged or Bluetooth dropped: pause rather than carry on out of the speaker. */
    private final BroadcastReceiver onNoisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // it may be Bluetooth dropping out: keep the window open in case the buds come back
            resumePending = true;
            droppedName = currentBluetoothName();
            resumeUntil = SystemClock.elapsedRealtime() + RESUME_WINDOW_MS;
            main.removeCallbacks(endWindow);
            main.postDelayed(endWindow, RESUME_WINDOW_MS);
            notifyListeners("focusLost", null);
            release();
        }
    };

    /** The notification's buttons (older Android; newer versions draw them from the session). */
    private final BroadcastReceiver onAction = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String a = intent.getAction();
            if (ACTION_PREV.equals(a)) control("prev", null);
            else if (ACTION_NEXT.equals(a)) control("next", null);
            else if (ACTION_TOGGLE.equals(a)) control(playing ? "pause" : "play", null);
        }
    };

    @Override
    public void load() {
        instance = this;
        session = new MediaSession(getContext(), "IEM Dream Bracket");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { control("play", null); }
            @Override public void onPause() { control("pause", null); }
            @Override public void onStop() { control("pause", null); }
            @Override public void onSkipToNext() { control("next", null); }
            @Override public void onSkipToPrevious() { control("prev", null); }
            @Override public void onSeekTo(long pos) { control("seek", pos / 1000.0); }
        });
        IntentFilter f = new IntentFilter();
        f.addAction(ACTION_PREV);
        f.addAction(ACTION_TOGGLE);
        f.addAction(ACTION_NEXT);
        ContextCompat.registerReceiver(getContext(), onAction, f, ContextCompat.RECEIVER_NOT_EXPORTED);
        audio().registerAudioDeviceCallback(onDevices, main);
    }

    /** The dropped buds are back: resume if media really goes to them and nothing else took over. */
    private void resumeIfBack() {
        if (!resumePending || droppedName == null || SystemClock.elapsedRealtime() > resumeUntil) return;
        AudioManager a = audio();
        boolean busy = a.getMode() != AudioManager.MODE_NORMAL || a.isMusicActive(); // a call, or another app playing
        boolean onBuds = false;
        for (AudioDeviceInfo o : a.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (isBluetooth(o.getType()) && droppedName.equals(nameOf(o))) onBuds = true;
        }
        cancelResume();
        if (busy || !onBuds) return;
        JSObject data = new JSObject();
        data.put("action", "play");
        data.put("fadeIn", RESUME_FADE_S);
        notifyListeners("control", data);
    }

    private void cancelResume() {
        resumePending = false;
        droppedName = null;
    }

    private static boolean isBluetooth(int type) {
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return true;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && (type == AudioDeviceInfo.TYPE_BLE_HEADSET || type == AudioDeviceInfo.TYPE_BLE_SPEAKER);
    }

    private static String nameOf(AudioDeviceInfo d) {
        CharSequence n = d.getProductName();
        return n == null ? "" : n.toString();
    }

    /** The Bluetooth media device still listed, if any (the drop is reported just before it goes). */
    private String currentBluetoothName() {
        try {
            for (AudioDeviceInfo d : audio().getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (isBluetooth(d.getType())) return nameOf(d);
            }
        } catch (RuntimeException e) {
            // vendor audio service trouble: the removal callback fills it in
        }
        return null;
    }

    private void control(String action, Double position) {
        cancelResume(); // you pressed something: no resuming on your behalf
        JSObject data = new JSObject();
        data.put("action", action);
        if (position != null) data.put("position", position);
        notifyListeners("control", data);
    }

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        cancelResume();
        main.removeCallbacks(endWindow);
        main.removeCallbacks(pausedTimeout);
        if (!holding) {
            int result;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build())
                    .setOnAudioFocusChangeListener(onFocus)
                    .build();
                result = audio().requestAudioFocus(focusRequest);
            } else {
                result = audio().requestAudioFocus(onFocus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }
            holding = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        if (!noisyRegistered) {
            ContextCompat.registerReceiver(getContext(), onNoisy,
                new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_EXPORTED);
            noisyRegistered = true;
        }
        // background: false tells the page Android refused the foreground service (started from the background on
        // Android 12+): the music plays while the app is open but isn't protected when it's minimised (review item 10)
        boolean background = true;
        try {
            Intent svcIntent = new Intent(getContext(), MediaPlaybackService.class);
            svcIntent.putExtra("playing", true);
            ContextCompat.startForegroundService(getContext(), svcIntent);
            MediaPlaybackService.updateLocks(getContext(), true);
        } catch (RuntimeException e) {
            background = false;
        }
        JSObject result = new JSObject();
        result.put("background", background);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        release();
        call.resolve();
    }

    private static final int MAX_NOTIFICATION_ART_PX = 256;

    private static Bitmap decodeScaledArt(String cover) {
        if (cover == null || cover.isEmpty()) return null;
        try {
            byte[] bytes = Base64.decode(cover, Base64.DEFAULT);
            if (bytes.length == 0) return null;
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            int maxDim = Math.max(bounds.outWidth, bounds.outHeight);
            int sample = 1;
            if (maxDim > MAX_NOTIFICATION_ART_PX) {
                while ((maxDim / sample) > MAX_NOTIFICATION_ART_PX) sample *= 2;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            // 16-bit only for JPEG (never transparent); PNG/WebP art may have alpha, which RGB_565 turns black (item 12)
            opts.inPreferredConfig = "image/jpeg".equals(bounds.outMimeType) ? Bitmap.Config.RGB_565 : Bitmap.Config.ARGB_8888;
            Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (decoded == null) return null;
            int dw = decoded.getWidth();
            int dh = decoded.getHeight();
            if (Math.max(dw, dh) > MAX_NOTIFICATION_ART_PX) {
                float scale = MAX_NOTIFICATION_ART_PX / (float) Math.max(dw, dh);
                Bitmap scaled = Bitmap.createScaledBitmap(
                    decoded,
                    Math.max(1, Math.round(dw * scale)),
                    Math.max(1, Math.round(dh * scale)),
                    true
                );
                if (scaled != decoded) decoded.recycle();
                return scaled;
            }
            return decoded;
        } catch (Throwable ignored) {
            return null;
        }
    }

    /**
     * The gallery's song and where it is: { title, artist, duration, position (s), playing, cover? (base64) }.
     * The cover is sent only when the song changes; "keepCover" keeps the last one.
     */
    @PluginMethod
    public void setNowPlaying(PluginCall call) {
        title = call.getString("title", "");
        artist = call.getString("artist", "");
        playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        MediaPlaybackService.updateLocks(getContext(), playing);
        double duration = call.getDouble("duration", 0.0);
        double position = call.getDouble("position", 0.0);
        boolean moving = playing && !Boolean.TRUE.equals(call.getBoolean("loading", false));
        if (!Boolean.TRUE.equals(call.getBoolean("keepCover", false))) {
            art = null;
            String cover = call.getString("cover");
            if (cover != null && !cover.isEmpty()) {
                art = decodeScaledArt(cover);
            }
        }
        try {
            MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, (long) (duration * 1000));
            if (art != null) meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
            session.setMetadata(meta.build());
        } catch (Throwable t) {
            art = null;
            try {
                MediaMetadata.Builder fallbackMeta = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, (long) (duration * 1000));
                session.setMetadata(fallbackMeta.build());
            } catch (Throwable ignored) {}
        }
        try {
            session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP)
                // §81 C: a song still loading is "buffering" at speed 0, so the lock-screen bar waits for the audio
                .setState(moving ? PlaybackState.STATE_PLAYING : playing ? PlaybackState.STATE_BUFFERING : PlaybackState.STATE_PAUSED,
                    (long) (position * 1000), moving ? 1f : 0f, SystemClock.elapsedRealtime())
                .build());
            session.setActive(true);
        } catch (Throwable ignored) {}
        // shown while playing (the service's) and kept, dismissible, while paused
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        if (nm != null) {
            try {
                nm.notify(NOTIFICATION_ID, buildNotification(getContext()));
            } catch (Throwable t) {
                art = null;
                try {
                    nm.notify(NOTIFICATION_ID, buildNotification(getContext()));
                } catch (Throwable ignored) {}
            }
        }
        call.resolve();
    }

    /** The gallery closed: no song any more. */
    @PluginMethod
    public void clearNowPlaying(PluginCall call) {
        title = null;
        art = null;
        playing = false;
        session.setActive(false);
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        if (MediaPlaybackService.running) nm.notify(NOTIFICATION_ID, buildNotification(getContext()));
        else nm.cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /** A gallery song is set (its notification stays, paused, after the service stops). */
    boolean hasSong() {
        return title != null;
    }

    private PendingIntent action(Context ctx, String name, int code) {
        Intent i = new Intent(name).setPackage(ctx.getPackageName());
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** The media notification: the gallery's song with controls, or just "Playing" for a match. */
    Notification buildNotification(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            b = new Notification.Builder(ctx, CHANNEL);
        } else {
            b = new Notification.Builder(ctx);
        }
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        b.setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE))
            .setOngoing(playing || title == null)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true);
        if (title == null) {
            return b.setContentTitle(ctx.getString(R.string.app_name)).setContentText("Playing").build();
        }
        b.setContentTitle(title).setContentText(artist);
        if (art != null) b.setLargeIcon(art);
        b.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", action(ctx, ACTION_PREV, 1)).build());
        b.addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            playing ? "Pause" : "Play", action(ctx, ACTION_TOGGLE, 2)).build());
        b.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", action(ctx, ACTION_NEXT, 3)).build());
        b.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private void release() {
        MediaPlaybackService.updateLocks(getContext(), false);
        if (holding) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                audio().abandonAudioFocusRequest(focusRequest);
            } else {
                audio().abandonAudioFocus(onFocus);
            }
            holding = false;
        }
        if (noisyRegistered) {
            try {
                getContext().unregisterReceiver(onNoisy);
            } catch (IllegalArgumentException ignored) {}
            noisyRegistered = false;
        }
        // waiting for dropped buds to come back: the service (and the app) stays up until endWindow
        if (resumePending && SystemClock.elapsedRealtime() < resumeUntil) return;
        if (hasSong() && MediaPlaybackService.running) {
            main.removeCallbacks(pausedTimeout);
            main.postDelayed(pausedTimeout, PAUSED_KEEP_MS);
            return;
        }
        getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
    }

    @Override
    protected void handleOnDestroy() {
        // Finishing or not (a renderer-crash recreate() lands here too), the audio lived in this WebView and is gone:
        // the service, its wake/Wi-Fi locks and the notification go with it (review item 5). A new plugin starts them
        // again when the next song plays.
        cancelResume();
        main.removeCallbacks(endWindow);
        try {
            audio().unregisterAudioDeviceCallback(onDevices);
        } catch (Throwable ignored) {}
        try {
            getContext().unregisterReceiver(onAction);
        } catch (IllegalArgumentException e) {
            // not registered
        }
        release();
        main.removeCallbacks(pausedTimeout);
        MediaPlaybackService.updateLocks(getContext(), false);
        getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
        if (session != null) session.release();
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
        if (instance == this) instance = null;
    }
}
