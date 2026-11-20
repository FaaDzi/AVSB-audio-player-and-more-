package com.iemdreambracket.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Plan §90 B / §93 Batch 3: Import song art and Sync lyrics keep going with the screen off or another app open, the way
 * Mihon's library and metadata updates do (a foreground service of type dataSync with a progress notification). The
 * page still does the work; this keeps the process awake (BulkWorkService), shows the progress with a Stop button, and
 * gives the page a timer that a hidden page's throttling can't stretch (sleep).
 */
@CapacitorPlugin(name = "BulkWork", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class BulkWorkPlugin extends Plugin {
    static final String CHANNEL = "bulk";
    static final int NOTIFICATION_ID = 0xB01;
    /** The "Done" note has its own id: the service takes its progress notification down with it. */
    static final int DONE_ID = 0xB02;
    private static final String ACTION_STOP = "com.iemdreambracket.app.BULK_STOP";

    /** A start was asked for: the service must still call startForeground, even if the job is over by then. */
    static boolean requested;
    static String title = "";
    static String text = "";
    static int done;
    static int total;
    /** Cancel was tapped: the notification and service are gone; late updates from the page are ignored until it finishes. */
    static boolean cancelled;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final BroadcastReceiver onStop = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // §94: the notification goes at once; the page (slow while hidden) catches up and posts "Stopped"
            cancelled = true;
            stopServiceSafely(context);
            context.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
            notifyListeners("stop", new JSObject());
        }
    };

    @Override
    public void load() {
        ContextCompat.registerReceiver(getContext(), onStop, new IntentFilter(ACTION_STOP), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    /**
     * §94 A: locked or in the background, the WebView marks the page hidden and Chromium stops running it after about a
     * minute (measured: 62 → 78 songs, then nothing for minutes, the process neither frozen nor paused). While a job
     * runs the WebView is told its window is still visible; finish() hands it the real visibility back.
     */
    @Override
    protected void handleOnStop() {
        if (!BulkWorkService.running && !requested) return;
        handler.postDelayed(() -> {
            WebView w = getBridge() == null ? null : getBridge().getWebView();
            if (w != null && (BulkWorkService.running || requested)) w.dispatchWindowVisibilityChanged(View.VISIBLE);
        }, 300);
    }

    @Override
    protected void handleOnDestroy() {
        try {
            getContext().unregisterReceiver(onStop);
        } catch (Throwable ignored) {}
        getContext().stopService(new Intent(getContext(), BulkWorkService.class));
    }

    /** Starts the service on the first call, then updates its notification. */
    @PluginMethod
    public void show(PluginCall call) {
        title = call.getString("title", "");
        text = call.getString("text", "");
        done = call.getInt("done", 0);
        total = call.getInt("total", 0);
        Context ctx = getContext();
        if (cancelled) {
            call.resolve();
            return;
        }
        try {
            if (!BulkWorkService.running && !requested) {
                requested = true;
                keepPageAwake(true);
                ContextCompat.startForegroundService(ctx, new Intent(ctx, BulkWorkService.class));
            } else {
                ctx.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, build(ctx, true));
            }
            call.resolve();
        } catch (Throwable e) {
            // Android refuses a foreground service started from the background: the job still runs, just unguarded
            call.reject(e.toString());
        }
    }

    /** The job ended: the service goes, and a short "Done" note stays until it's tapped or swiped. */
    @PluginMethod
    public void finish(PluginCall call) {
        Context ctx = getContext();
        cancelled = false;
        keepPageAwake(false);
        stopServiceSafely(ctx);
        String summary = call.getString("text", "");
        if (summary != null && !summary.isEmpty()) {
            text = summary;
            done = total;
            ctx.getSystemService(NotificationManager.class).notify(DONE_ID, build(ctx, false));
        }
        call.resolve();
    }

    /**
     * §94 A: while a job runs the renderer keeps the app's priority even when not visible (the default on the Xiaomi
     * already, measured; kept for phones where it isn't).
     */
    private void keepPageAwake(boolean on) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getBridge() == null) return;
        handler.post(() -> {
            WebView w = getBridge().getWebView();
            if (w == null) return;
            w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !on);
            // the job is over: the page learns whether it's really on screen (handleOnStop kept it "visible")
            if (!on) w.dispatchWindowVisibilityChanged(w.getWindowVisibility());
        });
    }

    private static void stopServiceSafely(Context ctx) {
        // stopping a service Android is still starting crashes the app (it never reached startForeground): the
        // service is told to finish instead, which it does right after going to the foreground
        if (requested) {
            try {
                ctx.startService(new Intent(ctx, BulkWorkService.class).setAction(BulkWorkService.ACTION_FINISH));
            } catch (Throwable e) {
                ctx.stopService(new Intent(ctx, BulkWorkService.class));
            }
        } else {
            ctx.stopService(new Intent(ctx, BulkWorkService.class));
        }
    }

    /** Resolves after `ms`: a native timer, unlike the page's, isn't slowed while the app is hidden. */
    @PluginMethod
    public void sleep(PluginCall call) {
        long ms = Math.max(0, call.getInt("ms", 0));
        handler.postDelayed(call::resolve, ms);
    }

    static Notification build(Context ctx, boolean working) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Song details", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            b = new Notification.Builder(ctx, CHANNEL);
        } else {
            b = new Notification.Builder(ctx);
        }
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        b.setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_IMMUTABLE))
            .setContentTitle(working && total > 0 ? title + " · " + done + " / " + total : title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setOngoing(working)
            .setAutoCancel(!working)
            .setCategory(Notification.CATEGORY_PROGRESS);
        if (working) {
            b.setProgress(Math.max(total, 1), Math.min(done, Math.max(total, 1)), total == 0);
            Intent stop = new Intent(ACTION_STOP).setPackage(ctx.getPackageName());
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 7, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", pi).build());
        }
        return b.build();
    }
}
