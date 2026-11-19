package com.iemdreambracket.app;

import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import java.util.ArrayDeque;

public class MainActivity extends BridgeActivity {
    private static final ArrayDeque<Long> RENDER_RECOVERIES = new ArrayDeque<>();
    private static final long RENDER_RECOVERY_WINDOW_MS = 30_000L;
    private static final int MAX_RENDER_RECOVERIES = 2;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DspUsbPlugin.class); // USB HID for DSP cables (Settings → DAC → Hardware EQ)
        registerPlugin(MediaPlaybackPlugin.class); // music keeps playing in the background; pauses for other apps
        registerPlugin(AudioRoutePlugin.class); // is music going to the phone's own speaker? (speaker guard)
        registerPlugin(MusicLibraryPlugin.class); // the songs on the phone (Gallery → Your songs)
        registerPlugin(ShellHostPlugin.class); // the new UI's /shell-host/* routes: library, covers, audio (plan §70 A2)
        registerPlugin(LinkPlugin.class); // the phone ↔ PC link: pairing, the PC's songs (plan §70 D2)
        registerPlugin(DirectDacPlugin.class); // Direct to DAC: native playback at the song's own rate to a USB DAC (plan §77)
        super.onCreate(savedInstanceState);
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                ShellHostPlugin host = ShellHostPlugin.get();
                WebResourceResponse answer = host == null ? null : host.serve(request);
                return answer != null ? answer : super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean crashed = detail != null && detail.didCrash();
                Log.e("MainActivity", "WebView render process gone (crashed=" + crashed + ")");
                long now = SystemClock.elapsedRealtime();
                while (!RENDER_RECOVERIES.isEmpty() && now - RENDER_RECOVERIES.peekFirst() > RENDER_RECOVERY_WINDOW_MS) {
                    RENDER_RECOVERIES.removeFirst();
                }
                if (RENDER_RECOVERIES.size() >= MAX_RENDER_RECOVERIES) {
                    return super.onRenderProcessGone(view, detail);
                }
                RENDER_RECOVERIES.addLast(now);
                try {
                    ViewParent parent = view.getParent();
                    if (parent instanceof ViewGroup) {
                        ((ViewGroup) parent).removeView(view);
                    }
                    view.destroy();
                } catch (Throwable ignored) {}
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) recreate();
                });
                return true;
            }
        });
        // A <video> shows the WebView's default poster (a grey box with a play icon) until its first
        // frame is up: the transition bursts flashed it. A clear 1×1 poster instead.
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        // The status and navigation bars stay visible, drawn over the app's dark background.
        // Hiding them (immersive mode) made Android show its "Viewing full screen" notice, and if
        // it was dismissed without "Got it" it came back over half the screen on every rotation.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(false); // light icons on the dark launch frame; the page sets its own (ShellHost.setSystemAppearance)
        bars.setAppearanceLightNavigationBars(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false); // the page fades its own band under the clock (§89 E)
            getWindow().setNavigationBarContrastEnforced(false);
        }
        // No padding of our own: with viewport-fit=cover Capacitor's SystemBars passes the bar and cut-out insets to the
        // page as env(safe-area-inset-*), so the theme shows behind the status bar. (On a WebView older than 140 it pads
        // the window itself, and setSystemAppearance colours that strip to match.)
    }

    /**
     * Closed (Quit, Back from the main menu), not just minimised: stop background services cleanly
     * without killing the OS process so WebView localStorage, IndexedDB, and SQLite WAL journals flush cleanly.
     */
    @Override
    public void onDestroy() {
        boolean closing = isFinishing();
        super.onDestroy();
        if (closing) MediaPlaybackService.endProcess(this);
    }
}
