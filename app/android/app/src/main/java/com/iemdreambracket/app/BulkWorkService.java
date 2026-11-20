package com.iemdreambracket.app;

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
 * The foreground service (type dataSync) that runs while Import song art or Sync lyrics works (BulkWorkPlugin), so
 * Android doesn't freeze the app with the screen off. Holds a CPU and Wi-Fi lock for as long as it runs, at most 3 h.
 */
public class BulkWorkService extends Service {
    static boolean running;
    static final String ACTION_FINISH = "finish";
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground(this, BulkWorkPlugin.NOTIFICATION_ID, BulkWorkPlugin.build(this, true), type);
        BulkWorkPlugin.requested = false;
        if (intent != null && ACTION_FINISH.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        try {
            if (wakeLock == null) {
                wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "iemdreambracket:bulk");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(3 * 60 * 60_000L);
            }
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "iemdreambracket:bulk");
                    wifiLock.setReferenceCounted(false);
                    wifiLock.acquire();
                }
            }
        } catch (Throwable ignored) {}
        return START_NOT_STICKY;
    }

    /** Android 15 ends a dataSync service after 6 h a day: stop cleanly (the job goes on, unguarded). */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Throwable ignored) {}
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf(); // swiping the app away ends the job with it
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
