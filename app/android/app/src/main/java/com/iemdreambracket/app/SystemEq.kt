package com.iemdreambracket.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.audiofx.AudioEffect
import android.media.audiofx.DynamicsProcessing
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * §119 (§115 C): AVSB's EQ in other apps, the way Wavelet does it. Players announce their audio sessions with
 * ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION; a DynamicsProcessing effect (API 28+) goes on each, with the curve sampled
 * into band gains, a preamp and a limiter. Session 0 (the whole output) is tried too where the phone allows it.
 * AVSB's own sessions are left alone (its EQ is already in its own playback). 360, crossfeed and linear phase don't
 * carry over: they live in AVSB's own audio graph.
 */
object SystemEqState {
    @Volatile var freqs: FloatArray = FloatArray(0)
    @Volatile var gains: FloatArray = FloatArray(0)
    @Volatile var preamp = 0f
    val effects = HashMap<Int, DynamicsProcessing>()

    @SuppressLint("NewApi")
    fun build(session: Int): DynamicsProcessing? {
        if (Build.VERSION.SDK_INT < 28 || freqs.isEmpty()) return null
        return try {
            val n = freqs.size
            val cfg = DynamicsProcessing.Config.Builder(DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION, 2, true, n, false, 0, false, 0, true).build()
            val dp = DynamicsProcessing(0, session, cfg)
            apply(dp)
            dp.enabled = true
            dp
        } catch (e: RuntimeException) {
            Log.i("SystemEq", "session $session refused: ${e.message}")
            null
        }
    }

    @SuppressLint("NewApi")
    fun apply(dp: DynamicsProcessing) {
        if (Build.VERSION.SDK_INT < 28) return
        val eq = DynamicsProcessing.Eq(true, true, freqs.size)
        // a band's cutoff is its upper edge: the gain holds from the previous edge up to this one
        for (i in freqs.indices) {
            val top = if (i + 1 < freqs.size) kotlin.math.sqrt(freqs[i] * freqs[i + 1]) else 20000f
            eq.setBand(i, DynamicsProcessing.EqBand(true, top, gains[i] + preamp))
        }
        dp.setPreEqAllChannelsTo(eq)
        dp.setLimiterAllChannelsTo(DynamicsProcessing.Limiter(true, true, 0, 1f, 60f, 10f, -1f, 0f))
    }

    fun refresh() = synchronized(effects) { effects.values.forEach { try { apply(it) } catch (_: RuntimeException) {} } }

    fun attach(session: Int) = synchronized(effects) {
        if (effects.containsKey(session)) return@synchronized
        build(session)?.let { effects[session] = it }
    }

    fun detach(session: Int) = synchronized(effects) { effects.remove(session)?.let { try { it.release() } catch (_: RuntimeException) {} } }

    fun clear() = synchronized(effects) { effects.values.forEach { try { it.release() } catch (_: RuntimeException) {} }; effects.clear() }
}

class SystemEqService : Service() {
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val session = i.getIntExtra(AudioEffect.EXTRA_AUDIO_SESSION, -1)
            if (session <= 0 || i.getStringExtra(AudioEffect.EXTRA_PACKAGE_NAME) == packageName) return
            if (i.action == AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION) SystemEqState.attach(session) else SystemEqState.detach(session)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "EQ in other apps", NotificationManager.IMPORTANCE_LOW))
        val n: Notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.mipmap.ic_launcher).setContentTitle("AVSB EQ in other apps").setContentText("Your EQ plays in other music and video apps").setOngoing(true).build()
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        val f = IntentFilter().apply { addAction(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION); addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION) }
        ContextCompat.registerReceiver(this, receiver, f, ContextCompat.RECEIVER_EXPORTED)
        // the whole output, where the phone allows it (many don't; apps that announce sessions are covered either way)
        SystemEqState.attach(0)
    }

    override fun onDestroy() {
        try { unregisterReceiver(receiver) } catch (_: IllegalArgumentException) {}
        SystemEqState.clear()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL = "system-eq"
        const val NOTIFICATION_ID = 4119
    }
}

@CapacitorPlugin(name = "SystemEq")
class SystemEqPlugin : Plugin() {
    /** {freqs: number[], gains: number[] (dB), preamp: dB, on: boolean}: starts, updates or stops the effect. */
    @PluginMethod
    fun set(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 28) return call.reject("Needs Android 9 or newer")
        val on = call.getBoolean("on") ?: false
        if (!on) {
            context.stopService(Intent(context, SystemEqService::class.java))
            return call.resolve(JSObject().put("on", false))
        }
        val f = call.getArray("freqs")?.toList<Number>()?.map { it.toFloat() } ?: return call.reject("No bands")
        val g = call.getArray("gains")?.toList<Number>()?.map { it.toFloat() } ?: return call.reject("No bands")
        if (f.size != g.size || f.isEmpty()) return call.reject("Bands don't match")
        val sizeChanged = SystemEqState.freqs.size != f.size
        SystemEqState.freqs = f.toFloatArray()
        SystemEqState.gains = g.toFloatArray()
        SystemEqState.preamp = (call.getDouble("preamp") ?: 0.0).toFloat()
        if (sizeChanged) SystemEqState.clear() else SystemEqState.refresh()
        ContextCompat.startForegroundService(context, Intent(context, SystemEqService::class.java))
        call.resolve(JSObject().put("on", true).put("sessions", synchronized(SystemEqState.effects) { SystemEqState.effects.size }))
    }
}
