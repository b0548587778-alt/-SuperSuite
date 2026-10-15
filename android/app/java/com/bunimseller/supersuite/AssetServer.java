package com.bunimseller.supersuite;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * מגיש את קבצי האפליקציה מתוך assets/www — מקבילה לפרוטוקול app:// של main.js.
 * כל מודול ב-origin נפרד (https://<mod>.DOMAIN), כמו בשולחן העבודה: localStorage והרשאות מופרדים.
 * כל בקשה לכתובת אחרת נחסמת כאן — אין שום גישה לרשת (וגם אין הרשאת INTERNET).
 */
final class AssetServer {
    /** דומיין שמור של Google לתוכן מקומי ב-WebView — לא מתנגש באתר אמיתי. */
    static final String DOMAIN = "supersuite.androidplatform.net";
    static final String[] MODULES = {"shell", "econ", "shamai", "trainer", "tools"};

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("webp", "image/webp");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("txt", "text/plain");
        MIME.put("wasm", "application/wasm");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("wav", "audio/wav");
    }

    private final AssetManager assets;

    AssetServer(AssetManager assets) { this.assets = assets; }

    static String origin(String mod) { return "https://" + mod + "." + DOMAIN; }

    static boolean isOurs(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && moduleOf(uri) != null;
    }

    private static String moduleOf(Uri uri) {
        String host = uri.getHost();
        if (host == null) return null;
        for (String m : MODULES) if (host.equals(m + "." + DOMAIN)) return m;
        return null;
    }

    WebResourceResponse serve(Uri uri) {
        String mod = isOurs(uri) ? moduleOf(uri) : null;
        if (mod == null) return error(403, "Forbidden");
        String path = uri.getPath();
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        // חסימת path traversal: אחרי פענוח (getPath מפענח) אין מקום ל-".." או ל-"\"
        if (path.contains("..") || path.contains("\\") || path.contains("\0")) return error(403, "Forbidden");
        String file = "www/" + mod + path;
        try {
            InputStream in = assets.open(file, AssetManager.ACCESS_STREAMING);
            String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("xml");
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers, in);
        } catch (IOException e) {
            return error(404, "Not Found");
        }
    }

    static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
}
