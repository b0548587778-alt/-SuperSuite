package com.bunimseller.supersuite;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** חלון יחיד: WebView של המעטפת, שבתוכו כל מודול הוא iframe (כמו WebContentsView בשולחן העבודה). */
public class MainActivity extends Activity {
    private static final String TAG = "SuperSuite";
    private static final int REQ_INPUT_FILE = 1;
    private static final int REQ_BASE = 1000;
    private static final long MAX_OPEN_BYTES = 200L * 1024 * 1024;

    private WebView web;
    private AssetServer assets;
    private String token;
    private ValueCallback<Uri[]> fileCallback;
    private WebView printView;

    /** בקשה פתוחה לבוחר הקבצים: מזהה הקריאה ב-JS ותוכן לכתיבה (אם יש) */
    private static final class Pending {
        final int cb; final byte[] data; final boolean open;
        Pending(int cb, byte[] data, boolean open) { this.cb = cb; this.data = data; this.open = open; }
    }
    private final Map<Integer, Pending> pending = new HashMap<>();
    private int nextReq = REQ_BASE;
    /** קבצים שהמשתמש בחר בבוחר השמירה — רק אליהם מותר לכתוב */
    private final Set<String> granted = Collections.synchronizedSet(new HashSet<>());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#0f1a30"));

        byte[] t = new byte[32];
        new SecureRandom().nextBytes(t);
        StringBuilder sb = new StringBuilder();
        for (byte b : t) sb.append(String.format("%02x", b));
        token = sb.toString();

        assets = new AssetServer(getAssets());
        web = new WebView(this);
        // שקוף עד שהעמוד נטען — רואים את מסך הפתיחה (רקע החלון), לא הבזק לבן
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setBlockNetworkLoads(true); // הכול מקומי; גם בלי הרשאת INTERNET
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.serve(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // ניווט מותר רק בתוך האפליקציה; קישורים חיצוניים לא נפתחים (אין רשת)
                return !AssetServer.isOurs(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // העמוד נטען: רקע רגיל במקום מסך הפתיחה (גם לחלקים שקופים בעמוד)
                view.setBackgroundColor(Color.parseColor("#f4f6fb"));
                // האסימון נמסר רק למסגרת הראשית, ורק כשהיא המעטפת שלנו
                Uri u = Uri.parse(url);
                if (AssetServer.isOurs(u) && (AssetServer.origin("shell")).equals("https://" + u.getHost())) {
                    view.evaluateJavascript("window.__ssSetToken&&window.__ssSetToken('" + token + "')", null);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(i, REQ_INPUT_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) { request.deny(); }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.e(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(this, token), "SuperSuiteBridge");
        setContentView(web);
        web.loadUrl(AssetServer.origin("shell") + "/shell.html");
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.__ssBack&&window.__ssBack())?1:0", v -> {
            if (!"1".equals(v)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /* ---------- קריאה חזרה ל-JS ---------- */
    private void callback(int cb, JSONObject result) {
        String js = "window.__ssAndroidCb&&window.__ssAndroidCb(" + cb + "," + JSONObject.quote(result.toString()) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    /* ---------- קבצים ---------- */
    void createDocument(int cb, String name, String mime, byte[] data) {
        runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            i.putExtra(Intent.EXTRA_TITLE, name);
            launch(i, new Pending(cb, data, false));
        });
    }

    void openText(int cb) {
        runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            launch(i, new Pending(cb, null, true));
        });
    }

    private void launch(Intent i, Pending p) {
        int req = nextReq++;
        pending.put(req, p);
        try {
            startActivityForResult(i, req);
        } catch (ActivityNotFoundException e) {
            pending.remove(req);
            callback(p.cb, new JSONObject());
        }
    }

    void writeGranted(String uri, byte[] data) throws Exception {
        if (!granted.remove(uri)) throw new SecurityException("הקובץ לא נבחר בבוחר השמירה");
        write(Uri.parse(uri), data);
    }

    private void write(Uri uri, byte[] data) throws Exception {
        try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IllegalStateException("לא ניתן לפתוח את הקובץ לכתיבה");
            out.write(data);
        }
    }

    private String displayName(Uri uri, String fallback) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) { }
        return fallback;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_INPUT_FILE) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    result = new Uri[clip.getItemCount()];
                    for (int k = 0; k < result.length; k++) result[k] = clip.getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            if (fileCallback != null) fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        Pending p = pending.remove(requestCode);
        if (p == null) return;
        JSONObject out = new JSONObject();
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (uri == null) { callback(p.cb, out); return; }
        // קריאה וכתיבה מחוץ ל-UI thread
        new Thread(() -> {
            try {
                String name = displayName(uri, "");
                if (p.open) {
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new IllegalStateException("open failed");
                        ByteArrayOutputStream buf = new ByteArrayOutputStream();
                        byte[] chunk = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(chunk)) > 0) {
                            buf.write(chunk, 0, n);
                            if (buf.size() > MAX_OPEN_BYTES) throw new IllegalStateException("הקובץ גדול מדי");
                        }
                        out.put("text", buf.toString("UTF-8"));
                    }
                } else if (p.data != null) {
                    write(uri, p.data);
                    out.put("ok", true);
                } else {
                    granted.add(uri.toString());
                    out.put("uri", uri.toString());
                }
                out.put("name", name);
            } catch (Exception e) {
                Log.e(TAG, "file op failed", e);
                runOnUiThread(() -> Toast.makeText(this, "פעולת הקובץ נכשלה: " + e.getMessage(), Toast.LENGTH_LONG).show());
                try { out.put("ok", false); out.remove("uri"); out.remove("text"); } catch (Exception ignored) { }
            }
            callback(p.cb, out);
        }).start();
    }

    /* ---------- הדפסה ---------- */
    // רינדור ה-HTML ב-WebView נסתר בלי JavaScript, ואז מסך ההדפסה של אנדרואיד (כולל "שמירה כ-PDF")
    void printHtml(String html, String baseUrl) {
        runOnUiThread(() -> {
            final WebView pv = new WebView(this);
            pv.getSettings().setJavaScriptEnabled(false);
            pv.getSettings().setBlockNetworkLoads(true);
            pv.getSettings().setAllowFileAccess(false);
            pv.getSettings().setAllowContentAccess(false);
            pv.setWebViewClient(new WebViewClient() {
                boolean done;
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return assets.serve(request.getUrl());
                }
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
                @Override
                public void onPageFinished(WebView view, String url) {
                    if (done) return;
                    done = true;
                    PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                    String job = "SuperSuite";
                    PrintAttributes attrs = new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build();
                    pm.print(job, view.createPrintDocumentAdapter(job), attrs);
                }
            });
            printView = pv; // שומרים הפניה עד סיום ההדפסה
            String base = baseUrl != null && Uri.parse(baseUrl).getHost() != null && AssetServer.isOurs(Uri.parse(baseUrl))
                    ? baseUrl : AssetServer.origin("shell") + "/";
            pv.loadDataWithBaseURL(base, html, "text/html", "utf-8", null);
        });
    }
}
