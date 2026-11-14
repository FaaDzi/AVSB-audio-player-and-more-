package com.iemdreambracket.app;

import android.Manifest;
import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.Intent;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Locale;

/**
 * Is media playing out of the phone's own speaker (src/audio/speakerGuard.ts)? Android sends
 * music to the built-in speaker whenever no headphones, USB audio, Bluetooth media device or
 * line/HDMI output is connected, so that's what's checked. Bluetooth SCO (a call-only headset)
 * doesn't count: media still goes to the speaker. Fires "change" when that flips.
 *
 * Also what media plays to (src/fit/system.ts): its type, product name and, for USB, the
 * vendor:product id, because Android's WebView doesn't name output devices the way Windows does,
 * so DSP cables, DACs and Bluetooth buds weren't recognised on a phone. Fires "devices" when any
 * output comes or goes. And the Bluetooth codec in use (`codec`), which needs BLUETOOTH_CONNECT;
 * that's asked for only when the user opens the codec card. Read-only. API 23+.
 */
@CapacitorPlugin(
    name = "AudioRoute",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class AudioRoutePlugin extends Plugin {
    private AudioManager am;
    private Boolean last = null;

    private final AudioDeviceCallback onDevices = new AudioDeviceCallback() {
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { report(); }
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { report(); }
    };

    @Override
    public void load() {
        am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) am.registerAudioDeviceCallback(onDevices, new Handler(Looper.getMainLooper()));
    }

    @Override
    protected void handleOnDestroy() {
        if (am != null) am.unregisterAudioDeviceCallback(onDevices);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("speaker", onSpeaker());
        call.resolve(ret);
    }

    /** The output media plays to: { type, name, usb ("vvvv:pppp") }, or {} for the phone's own speaker/unknown. */
    @PluginMethod
    public void output(PluginCall call) {
        call.resolve(describe(mediaOutput()));
    }

    private void report() {
        notifyListeners("devices", describe(mediaOutput()));
        boolean now = onSpeaker();
        if (last != null && last == now) return;
        last = now;
        JSObject data = new JSObject();
        data.put("speaker", now);
        notifyListeners("change", data);
    }

    private boolean onSpeaker() {
        if (am == null) return false;
        try {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (isExternal(d.getType())) return false;
            }
            return true;
        } catch (RuntimeException e) {
            return false; // some vendor builds throw from the audio service; assume headphones (guard off)
        }
    }

    /** Where media goes: Android 13+ says; before that, the same priority Android routes by. */
    private AudioDeviceInfo mediaOutput() {
        if (am == null) return null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                AudioAttributes media = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build();
                List<AudioDeviceInfo> l = am.getAudioDevicesForAttributes(media);
                if (!l.isEmpty()) return l.get(0);
            }
            AudioDeviceInfo best = null;
            int bestRank = 0;
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int r = rank(d.getType());
                if (r > bestRank) {
                    best = d;
                    bestRank = r;
                }
            }
            return best;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Newest-plugged wins on Android; this approximates it: USB, then wired, then Bluetooth. */
    private static int rank(int type) {
        if (type == AudioDeviceInfo.TYPE_USB_DEVICE || type == AudioDeviceInfo.TYPE_USB_ACCESSORY) return 6;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && type == AudioDeviceInfo.TYPE_USB_HEADSET) return 6;
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || type == AudioDeviceInfo.TYPE_WIRED_HEADSET) return 5;
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return 4;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && (type == AudioDeviceInfo.TYPE_BLE_HEADSET || type == AudioDeviceInfo.TYPE_BLE_SPEAKER)) return 4;
        if (isExternal(type)) return 3;
        if (type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return 1;
        return 0;
    }

    private JSObject describe(AudioDeviceInfo d) {
        JSObject o = new JSObject();
        if (d == null) return o;
        int t = d.getType();
        String kind;
        if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) kind = "bluetooth";
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER)) kind = "bluetooth";
        else if (t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_ACCESSORY
            || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && t == AudioDeviceInfo.TYPE_USB_HEADSET)) kind = "usb";
        else if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET) kind = "wired";
        else if (t == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) kind = "speaker";
        else kind = "other";
        o.put("type", kind);
        CharSequence name = d.getProductName();
        o.put("name", name == null ? "" : name.toString());
        if ("usb".equals(kind)) {
            String usb = usbId(name == null ? "" : name.toString());
            if (usb != null) o.put("usb", usb);
        }
        return o;
    }

    /** vendor:product of the USB audio device (by name, else the only audio-class device plugged in). */
    private String usbId(String name) {
        try {
            UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
            if (um == null) return null;
            UsbDevice only = null;
            int audio = 0;
            for (UsbDevice u : um.getDeviceList().values()) {
                if (!hasAudio(u)) continue;
                audio++;
                only = u;
                String pn = u.getProductName();
                if (pn != null && !name.isEmpty() && pn.equalsIgnoreCase(name)) return hex(u);
            }
            return audio == 1 ? hex(only) : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static boolean hasAudio(UsbDevice u) {
        if (u.getDeviceClass() == 1) return true;
        for (int i = 0; i < u.getInterfaceCount(); i++) if (u.getInterface(i).getInterfaceClass() == 1) return true;
        return false;
    }

    private static String hex(UsbDevice u) {
        return String.format(Locale.ROOT, "%04x:%04x", u.getVendorId(), u.getProductId());
    }

    /**
     * The Bluetooth codec in use: { name, codec, sampleRate, bits, ldacKbps? } or { known: false }.
     * Android has no public call for it on every version, so it's read through reflection
     * (BluetoothA2dp.getCodecStatus); some phones refuse, and then the app says "codec unknown".
     */
    @PluginMethod
    public void codec(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "codecPermission");
            return;
        }
        readCodec(call);
    }

    @PermissionCallback
    private void codecPermission(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("known", false);
            r.put("denied", true);
            call.resolve(r);
            return;
        }
        readCodec(call);
    }

    private void readCodec(PluginCall call) {
        JSObject unknown = new JSObject();
        unknown.put("known", false);
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
        if (ad == null) {
            call.resolve(unknown);
            return;
        }
        try {
            boolean asked = ad.getProfileProxy(getContext(), new BluetoothProfile.ServiceListener() {
                @Override
                public void onServiceConnected(int profile, BluetoothProfile proxy) {
                    JSObject r = unknown;
                    try {
                        List<BluetoothDevice> devs = proxy.getConnectedDevices();
                        if (!devs.isEmpty()) r = codecOf((BluetoothA2dp) proxy, devs.get(0));
                    } catch (RuntimeException e) {
                        r = unknown;
                    }
                    ad.closeProfileProxy(BluetoothProfile.A2DP, proxy);
                    call.resolve(r);
                }

                @Override
                public void onServiceDisconnected(int profile) {}
            }, BluetoothProfile.A2DP);
            if (!asked) call.resolve(unknown);
        } catch (RuntimeException e) {
            call.resolve(unknown);
        }
    }

    private static JSObject codecOf(BluetoothA2dp a2dp, BluetoothDevice dev) {
        JSObject r = new JSObject();
        r.put("known", false);
        try {
            r.put("name", dev.getName());
        } catch (SecurityException e) {
            // name needs the permission too
        }
        try {
            Method status = BluetoothA2dp.class.getMethod("getCodecStatus", BluetoothDevice.class);
            Object st = status.invoke(a2dp, dev);
            if (st == null) return r;
            Object cfg = st.getClass().getMethod("getCodecConfig").invoke(st);
            if (cfg == null) return r;
            int type = (Integer) cfg.getClass().getMethod("getCodecType").invoke(cfg);
            int rate = (Integer) cfg.getClass().getMethod("getSampleRate").invoke(cfg);
            int bits = (Integer) cfg.getClass().getMethod("getBitsPerSample").invoke(cfg);
            long specific1 = (Long) cfg.getClass().getMethod("getCodecSpecific1").invoke(cfg);
            r.put("known", true);
            r.put("codec", codecName(type));
            r.put("sampleRate", sampleRate(rate));
            r.put("bits", bitsOf(bits));
            if (type == 4) {
                // LDAC's quality mode lives in codec-specific 1: 1000/1001/1002 = 990/660/330 kbps, 1003 = adaptive
                int mode = (int) specific1;
                r.put("ldacKbps", mode == 1000 ? 990 : mode == 1001 ? 660 : mode == 1002 ? 330 : 0);
            }
        } catch (ReflectiveOperationException | RuntimeException e) {
            // not readable on this phone
        }
        return r;
    }

    /** BluetoothCodecConfig.SOURCE_CODEC_TYPE_*; vendor codecs (Samsung's Scalable/SSC) show as "Vendor". */
    private static String codecName(int t) {
        switch (t) {
            case 0: return "SBC";
            case 1: return "AAC";
            case 2: return "aptX";
            case 3: return "aptX HD";
            case 4: return "LDAC";
            case 5: return "LC3";
            case 6: return "Opus";
            default: return "Vendor";
        }
    }

    /** BluetoothCodecConfig.SAMPLE_RATE_* bit flags → Hz (0 = not known). */
    private static int sampleRate(int flag) {
        switch (flag) {
            case 0x1: return 44100;
            case 0x2: return 48000;
            case 0x4: return 88200;
            case 0x8: return 96000;
            case 0x10: return 176400;
            case 0x20: return 192000;
            default: return 0;
        }
    }

    /** BluetoothCodecConfig.BITS_PER_SAMPLE_* bit flags → bits. */
    private static int bitsOf(int flag) {
        switch (flag) {
            case 0x1: return 16;
            case 0x2: return 24;
            case 0x4: return 32;
            default: return 0;
        }
    }

    /** The phone's Bluetooth settings, where the buds' own options are (and Developer options for LDAC). */
    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Couldn't open Bluetooth settings");
        }
    }

    static boolean isExternal(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_HDMI:
            case AudioDeviceInfo.TYPE_HDMI_ARC:
            case AudioDeviceInfo.TYPE_LINE_ANALOG:
            case AudioDeviceInfo.TYPE_LINE_DIGITAL:
            case AudioDeviceInfo.TYPE_AUX_LINE:
            case AudioDeviceInfo.TYPE_DOCK:
                return true;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && type == AudioDeviceInfo.TYPE_USB_HEADSET) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && type == AudioDeviceInfo.TYPE_HEARING_AID) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && (type == AudioDeviceInfo.TYPE_BLE_HEADSET || type == AudioDeviceInfo.TYPE_BLE_SPEAKER)) return true;
        return false;
    }
}
