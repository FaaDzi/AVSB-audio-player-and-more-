package com.iemdreambracket.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.ServiceCompat;

/**
 * Runs while music plays, and for a while after a pause (MediaPlaybackPlugin), so Android keeps the app's audio going
 * with the screen off or the app in the background. Its notification is the plugin's media notification, and it never
 * outlives the service: closing the app (swiped away, or Back out of it) takes both down.
 */
public class MediaPlaybackService extends Service {
    static boolean running;
    private static final String WAKE_TAG = "iemdreambracket:playback";
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    /** Low latency only holds while the screen is on; this one covers screen-off streaming (review item 6). */
    private WifiManager.WifiLock wifiPerfLock;

    static void updateLocks(Context ctx, boolean active) {
        if (ctx == null) return;
        MediaPlaybackService svc = activeService;
        if (svc == null) return;
        if (active) svc.acquireLocks();
        else svc.releaseLocks();
    }

    private static volatile MediaPlaybackService activeService;

    private synchronized void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = getSystemService(PowerManager.class);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_TAG);
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                // Bounded per acquisition; refreshed while playback continues.
                wakeLock.acquire(4 * 60 * 60_000L);
            }
        } catch (Throwable ignored) {}
        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(mode, WAKE_TAG);
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (wifiPerfLock == null) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    if (wm != null) {
                        wifiPerfLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, WAKE_TAG + ":screen-off");
                        wifiPerfLock.setReferenceCounted(false);
                    }
                }
                if (wifiPerfLock != null && !wifiPerfLock.isHeld()) wifiPerfLock.acquire();
            }
        } catch (Throwable ignored) {}
    }

    private synchronized void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) {}
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Throwable ignored) {}
        try {
            if (wifiPerfLock != null && wifiPerfLock.isHeld()) wifiPerfLock.release();
        } catch (Throwable ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        activeService = this;
        MediaPlaybackPlugin plugin = MediaPlaybackPlugin.instance;
        if (plugin == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = plugin.buildNotification(this);
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, MediaPlaybackPlugin.NOTIFICATION_ID, n, type);
        running = true;
        boolean playingNow = intent == null || intent.getBooleanExtra("playing", true);
        if (playingNow) acquireLocks();
        else releaseLocks();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (activeService == this) activeService = null;
        releaseLocks();
        // the notification goes with the service: paused songs keep the service (MediaPlaybackPlugin.PAUSED_KEEP_MS),
        // so a notification left behind could only outlive the app
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(MediaPlaybackPlugin.NOTIFICATION_ID);
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf(); // swiping the app away ends playback, and its notification, with it
        endProcess(this);
    }

    /** The app was closed: take the notification and services down cleanly without killing the process so WebView storage flushes. */
    static void endProcess(Context ctx) {
        ctx.stopService(new Intent(ctx, MediaPlaybackService.class));
        ctx.getSystemService(NotificationManager.class).cancel(MediaPlaybackPlugin.NOTIFICATION_ID);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
