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
import android.provider.DocumentsContract;
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
    /** תקרה לפתיחת קובץ (שחזור גיבוי). בפועל — גם לפי הזיכרון של האפליקציה (maxOpenBytes) */
    private static final long MAX_OPEN_BYTES = 64L * 1024 * 1024;
    private static final String OPEN_TOO_BIG = "הקובץ גדול מדי לזיכרון של המכשיר";

    private WebView web;
    private AssetServer assets;
    private TreeFiles trees;
    private String token;
    private ValueCallback<Uri[]> fileCallback;
    private WebView printView;

    /** בקשה פתוחה לבוחר הקבצים: מזהה הקריאה ב-JS ותוכן לכתיבה (אם יש); tree — בוחר תיקייה */
    private static final class Pending {
        final int cb; final byte[] data; final boolean open; final boolean tree;
        Pending(int cb, byte[] data, boolean open) { this(cb, data, open, false); }
        Pending(int cb, byte[] data, boolean open, boolean tree) { this.cb = cb; this.data = data; this.open = open; this.tree = tree; }
    }
    private final Map<Integer, Pending> pending = new HashMap<>();
    private int nextReq = REQ_BASE;
    /** קבצים שהמשתמש בחר בבוחר השמירה — רק אליהם מותר לכתוב */
    private final Set<String> granted = Collections.synchronizedSet(new HashSet<>());
    /** תיקיות שהמשתמש בחר בבוחר התיקיות — רק בתוכן מותר לכתוב */
    private final Set<String> grantedTrees = Collections.synchronizedSet(new HashSet<>());

    /**
     * הקובץ מועתק כמה פעמים בדרך ל-JS (בתים ← מחרוזת ← JSON ← evaluateJavascript), ולכן התקרה היא חלק קטן
     * מהזיכרון של האפליקציה — קובץ גדול יותר נדחה בהודעה, במקום OutOfMemoryError שמקריס את האפליקציה.
     */
    private static long maxOpenBytes() {
        return Math.min(MAX_OPEN_BYTES, Runtime.getRuntime().maxMemory() / 12);
    }

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
        trees = new TreeFiles(getContentResolver());
        web = new WebView(this);
        // שקוף עד שהעמוד נטען — רואים את מסך הפתיחה (רקע החלון), לא הבזק לבן
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // הכול מקומי: ה-WebView לא פונה לרשת אף פעם. הרשאת INTERNET משמשת רק את RelayClient (שרת הרישוי)
        s.setBlockNetworkLoads(true);
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

    /* ---------- תיקייה (קבצים במבנה אחיד) ---------- */
    void pickFolder(int cb) {
        runOnUiThread(() -> launch(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), new Pending(cb, null, false, true)));
    }

    private Uri grantedTree(String tree) {
        if (tree == null || !grantedTrees.contains(tree)) throw new SecurityException("התיקייה לא נבחרה בבוחר התיקיות");
        return Uri.parse(tree);
    }

    boolean treeExists(String tree, String rel) { return trees.exists(grantedTree(tree), rel); }

    void treeMkdirs(String tree, String rel) throws Exception { trees.mkdirs(grantedTree(tree), rel); }

    void treeWrite(String tree, String rel, byte[] data) throws Exception { trees.write(grantedTree(tree), rel, data); }

    private String treeName(Uri tree) {
        try {
            return displayName(DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)), "");
        } catch (Exception e) {
            return "";
        }
    }

    /* ---------- שרת הרישוי ---------- */
    // ברקע (לא ב-thread של הגשר); התשובה חוזרת ב-__ssAndroidCb: {status, body} או {error}
    void relayPost(int cb, String origin, String body) {
        new Thread(() -> {
            JSONObject out;
            try {
                out = RelayClient.post(origin, body);
            } catch (Throwable e) {
                Log.w(TAG, "relay request failed: " + e.getClass().getSimpleName());
                out = new JSONObject();
                try { out.put("error", "אין חיבור לשרת הרישוי. בדקו את החיבור לאינטרנט ואת כתובת השרת"); } catch (Exception ignored) { }
            }
            callback(cb, out);
        }).start();
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
                if (p.open) {
                    long max = maxOpenBytes();
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new IllegalStateException("לא ניתן לפתוח את הקובץ");
                        ByteArrayOutputStream buf = new ByteArrayOutputStream();
                        byte[] chunk = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(chunk)) > 0) {
                            buf.write(chunk, 0, n);
                            if (buf.size() > max) throw new IllegalStateException(OPEN_TOO_BIG + " (עד " + (max / (1024 * 1024)) + "MB)");
                        }
                        out.put("text", buf.toString("UTF-8"));
                    }
                } else if (p.tree) {
                    grantedTrees.add(uri.toString());
                    out.put("uri", uri.toString());
                } else if (p.data != null) {
                    write(uri, p.data);
                    out.put("ok", true);
                } else {
                    granted.add(uri.toString());
                    out.put("uri", uri.toString());
                }
                out.put("name", p.tree ? treeName(uri) : displayName(uri, ""));
            } catch (OutOfMemoryError e) {
                // קובץ גדול שעבר את התקרה בכל זאת — הודעה, לא קריסה של האפליקציה
                failFileOp(out, OPEN_TOO_BIG);
            } catch (Exception e) {
                Log.e(TAG, "file op failed", e);
                failFileOp(out, e.getMessage());
            }
            try {
                callback(p.cb, out);
            } catch (OutOfMemoryError e) {
                failFileOp(out, OPEN_TOO_BIG);
                callback(p.cb, out);
            }
        }).start();
    }

    private void failFileOp(JSONObject out, String message) {
        runOnUiThread(() -> Toast.makeText(this, "פעולת הקובץ נכשלה: " + message, Toast.LENGTH_LONG).show());
        try { out.remove("uri"); out.remove("text"); out.put("ok", false); } catch (Exception ignored) { }
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
