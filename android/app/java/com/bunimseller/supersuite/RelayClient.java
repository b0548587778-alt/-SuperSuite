package com.bunimseller.supersuite;

import android.net.Uri;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

/**
 * הפנייה היחידה של האפליקציה לרשת: בקשה לשרת הרישוי (shell/licensing/remote.js דרך android/web/relay-fetch.js).
 * רק POST של JSON ל-https://<מארח>[:פורט]/v1, בלי הפניות (redirect), עם זמן קצוב ותקרה לגודל — כמו remote.js.
 * הגשר (Bridge.relayPost) דורש את האסימון של המעטפת, כך ש-iframe של מודול לא יכול לפנות לרשת.
 */
final class RelayClient {
    static final int TIMEOUT_MS = 15000;
    static final int MAX_REQUEST_BYTES = 8 * 1024 * 1024;
    static final int MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

    private RelayClient() { }

    /** origin = https, מארח ופורט (אופציונלי) בלבד (כמו validateUrl ב-remote.js, בלי http מקומי). הנתיב תמיד /v1 */
    static URL endpoint(String origin) throws Exception {
        Uri u = Uri.parse(origin == null ? "" : origin);
        String host = u.getHost();
        String path = u.getEncodedPath();
        if (!"https".equals(u.getScheme()) || host == null || host.isEmpty()) {
            throw new IllegalArgumentException("כתובת שרת הרישוי חייבת להתחיל ב-https://");
        }
        if (u.getEncodedUserInfo() != null || u.getEncodedQuery() != null || u.getEncodedFragment() != null
                || (path != null && !path.isEmpty() && !path.equals("/"))) {
            throw new IllegalArgumentException("כתובת שרת הרישוי אינה תקינה");
        }
        return new URL("https", host, u.getPort(), "/v1");
    }

    /** מחזיר {"status": קוד, "body": טקסט התשובה}. כשל ברשת — חריגה. */
    static JSONObject post(String origin, String body) throws Exception {
        byte[] payload = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
        if (payload.length > MAX_REQUEST_BYTES) throw new IllegalArgumentException("הבקשה לשרת הרישוי גדולה מדי");
        URL url = endpoint(origin);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        try {
            if (!(c instanceof HttpsURLConnection)) throw new SecurityException("חיבור לא מוצפן לשרת הרישוי");
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(TIMEOUT_MS);
            c.setReadTimeout(TIMEOUT_MS);
            c.setUseCaches(false);
            c.setDoOutput(true);
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "application/json");
            c.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = c.getOutputStream()) {
                out.write(payload);
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = "";
            if (in != null) {
                try (InputStream src = in) {
                    text = readCapped(src);
                }
            }
            return new JSONObject().put("status", status).put("body", text);
        } finally {
            c.disconnect();
        }
    }

    private static String readCapped(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[64 * 1024];
        int n;
        while ((n = in.read(chunk)) > 0) {
            buf.write(chunk, 0, n);
            if (buf.size() > MAX_RESPONSE_BYTES) throw new IllegalStateException("התשובה משרת הרישוי גדולה מדי");
        }
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }
}
