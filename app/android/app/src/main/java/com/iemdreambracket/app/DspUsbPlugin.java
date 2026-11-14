package com.iemdreambracket.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;

/**
 * USB HID reports to and from a DSP cable or dongle (src/dsp/transport.ts), because Android's
 * WebView has no WebHID. Only the device's HID interface is claimed, so audio keeps playing.
 * Reports go out on the interrupt OUT endpoint (or as a SET_REPORT control transfer when there
 * is none) and come back from the interrupt IN endpoint as "report" events, report ID split
 * off the way WebHID does it.
 */
@CapacitorPlugin(name = "DspUsb")
public class DspUsbPlugin extends Plugin {
    private static final String ACTION_PERMISSION = "com.iemdreambracket.app.USB_PERMISSION";
    private UsbDeviceConnection conn;
    private UsbInterface iface;
    private UsbEndpoint in;
    private UsbEndpoint out;
    private Thread reader;
    private volatile boolean reading;

    private UsbManager usb() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        int vendorId = call.getInt("vendorId", 0);
        UsbDevice found = null;
        for (UsbDevice d : usb().getDeviceList().values()) {
            if (d.getVendorId() == vendorId) {
                found = d;
                break;
            }
        }
        if (found == null) {
            call.reject("No DSP cable or dongle found. Plug it in and try again.");
            return;
        }
        if (usb().hasPermission(found)) {
            open(call, found);
            return;
        }
        final UsbDevice device = found;
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!ACTION_PERMISSION.equals(intent.getAction())) return;
                getContext().unregisterReceiver(this);
                if (usb().hasPermission(device)) open(call, device);
                else call.reject("USB access was not allowed.");
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(ACTION_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED);
        Intent intent = new Intent(ACTION_PERMISSION).setPackage(getContext().getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        usb().requestPermission(device, PendingIntent.getBroadcast(getContext(), 0, intent, flags));
    }

    private void open(PluginCall call, UsbDevice device) {
        close();
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface f = device.getInterface(i);
            if (f.getInterfaceClass() != UsbConstants.USB_CLASS_HID) continue;
            iface = f;
            for (int e = 0; e < f.getEndpointCount(); e++) {
                UsbEndpoint ep = f.getEndpoint(e);
                if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_INT) continue;
                if (ep.getDirection() == UsbConstants.USB_DIR_IN) in = ep;
                else out = ep;
            }
            break;
        }
        if (iface == null || in == null) {
            call.reject("This device has no HID control interface.");
            return;
        }
        conn = usb().openDevice(device);
        if (conn == null || !conn.claimInterface(iface, true)) {
            close();
            call.reject("Couldn't open the device.");
            return;
        }
        startReading();
        JSObject info = new JSObject();
        info.put("vendorId", device.getVendorId());
        info.put("productId", device.getProductId());
        info.put("productName", device.getProductName() == null ? "" : device.getProductName().trim());
        call.resolve(info);
    }

    private void startReading() {
        reading = true;
        final UsbDeviceConnection c = conn;
        final UsbEndpoint ep = in;
        reader = new Thread(() -> {
            byte[] buf = new byte[Math.max(64, ep.getMaxPacketSize())];
            while (reading) {
                int n = c.bulkTransfer(ep, buf, buf.length, 250);
                if (n <= 1) continue;
                JSArray data = new JSArray();
                for (int i = 1; i < n; i++) data.put(buf[i] & 0xff);
                JSObject r = new JSObject();
                r.put("reportId", buf[0] & 0xff);
                r.put("data", data);
                notifyListeners("report", r);
            }
        }, "dsp-usb-reader");
        reader.start();
    }

    @PluginMethod
    public void send(PluginCall call) {
        if (conn == null) {
            call.reject("Not connected.");
            return;
        }
        int reportId = call.getInt("reportId", 0);
        JSONArray data = call.getArray("data");
        byte[] buf = new byte[data.length() + 1];
        buf[0] = (byte) reportId;
        try {
            for (int i = 0; i < data.length(); i++) buf[i + 1] = (byte) data.getInt(i);
        } catch (JSONException e) {
            call.reject("Bad report data.");
            return;
        }
        int n = out != null
            ? conn.bulkTransfer(out, buf, buf.length, 1000)
            // HID class SET_REPORT, output report: bmRequestType 0x21, bRequest 0x09, wValue (2 << 8) | id
            : conn.controlTransfer(0x21, 0x09, (2 << 8) | reportId, iface.getId(), buf, buf.length, 1000);
        if (n < 0) call.reject("The device didn't take the report.");
        else call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        close();
        call.resolve();
    }

    private void close() {
        reading = false;
        if (reader != null) {
            try {
                reader.join(500);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            reader = null;
        }
        if (conn != null) {
            if (iface != null) conn.releaseInterface(iface);
            conn.close();
        }
        conn = null;
        iface = null;
        in = null;
        out = null;
    }

    @Override
    protected void handleOnDestroy() {
        close();
    }
}
