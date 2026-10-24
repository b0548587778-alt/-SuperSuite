package com.bunimseller.supersuite;

import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * הגשר בין JavaScript ל-Java (window.SuperSuiteBridge). מחליף את מה שב-Electron עשה Node:
 * SQLite, scrypt, AES-GCM, קבצים, הדפסה, והחיבור לשרת הרישוי (הפנייה היחידה לרשת).
 * כל קריאה דורשת אסימון שנמסר רק למסגרת הראשית (המעטפת) — iframe של מודול לא יכול להשתמש בגשר.
 * תשובה: JSON {"r": תוצאה} או {"e": "הודעה"}.
 */
final class Bridge {
    private final MainActivity activity;
    private final String token;
    private final SqlBridge sql;
    private final SecureRandom random = new SecureRandom();

    Bridge(MainActivity activity, String token) {
        this.activity = activity;
        this.token = token;
        this.sql = new SqlBridge(activity);
    }

    private interface Body { Object run() throws Exception; }

    private String guard(String t, Body body) {
        try {
            if (t == null || !MessageDigest.isEqual(t.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8))) {
                return err("forbidden");
            }
            Object r = body.run();
            return new JSONObject().put("r", r == null ? JSONObject.NULL : r).toString();
        } catch (Throwable e) {
            String m = e.getMessage();
            return err(m == null || m.isEmpty() ? e.getClass().getSimpleName() : m);
        }
    }

    private static String err(String msg) {
        try { return new JSONObject().put("e", msg).toString(); } catch (Exception e) { return "{\"e\":\"error\"}"; }
    }

    private static byte[] b64(String s) { return Base64.decode(s, Base64.NO_WRAP); }
    private static String b64(byte[] b) { return Base64.encodeToString(b, Base64.NO_WRAP); }

    /* ---------- crypto ---------- */
    @JavascriptInterface
    public String randomBytes(String t, int n) {
        return guard(t, () -> {
            if (n < 0 || n > 1024 * 1024) throw new IllegalArgumentException("size");
            byte[] b = new byte[n];
            random.nextBytes(b);
            return b64(b);
        });
    }

    @JavascriptInterface
    public String scrypt(String t, String pw, String salt, int N, int r, int p, int keylen) {
        return guard(t, () -> b64(Scrypt.derive(b64(pw), b64(salt), N, r, p, keylen)));
    }

    /** AES-256-GCM. הצפנה מחזירה ciphertext||tag (16 בתים), פענוח מקבל אותו מבנה. */
    @JavascriptInterface
    public String aesGcm(String t, boolean encrypt, String key, String iv, String data) {
        return guard(t, () -> {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(encrypt ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, new SecretKeySpec(b64(key), "AES"), new GCMParameterSpec(128, b64(iv)));
            return b64(c.doFinal(b64(data)));
        });
    }

    /* ---------- SQLite ---------- */
    @JavascriptInterface
    public String dbOpen(String t, String name) { return guard(t, () -> { sql.open(name); return true; }); }

    @JavascriptInterface
    public String dbExec(String t, String s) { return guard(t, () -> { sql.exec(s); return true; }); }

    @JavascriptInterface
    public String dbRun(String t, String s, String params) { return guard(t, () -> { sql.run(s, params); return true; }); }

    @JavascriptInterface
    public String dbAll(String t, String s, String params) {
        return guard(t, () -> {
            JSONArray rows = sql.all(s, params);
            return rows;
        });
    }

    /* ---------- קבצים (בוחר הקבצים של אנדרואיד) ---------- */
    @JavascriptInterface
    public String createDocument(String t, int cb, String name, String mime) {
        return guard(t, () -> { activity.createDocument(cb, name, mime, null); return true; });
    }

    @JavascriptInterface
    public String writeUri(String t, String uri, String data) {
        return guard(t, () -> { activity.writeGranted(uri, b64(data)); return true; });
    }

    @JavascriptInterface
    public String saveBytes(String t, int cb, String name, String mime, String data) {
        return guard(t, () -> { activity.createDocument(cb, name, mime, b64(data)); return true; });
    }

    @JavascriptInterface
    public String saveText(String t, int cb, String name, String mime, String text) {
        return guard(t, () -> { activity.createDocument(cb, name, mime, text.getBytes(StandardCharsets.UTF_8)); return true; });
    }

    @JavascriptInterface
    public String openText(String t, int cb) {
        return guard(t, () -> { activity.openText(cb); return true; });
    }

    /* ---------- תיקייה שנבחרה (קבצים במבנה אחיד) ---------- */
    @JavascriptInterface
    public String pickFolder(String t, int cb) {
        return guard(t, () -> { activity.pickFolder(cb); return true; });
    }

    @JavascriptInterface
    public String treeExists(String t, String tree, String rel) {
        return guard(t, () -> activity.treeExists(tree, rel));
    }

    @JavascriptInterface
    public String treeMkdirs(String t, String tree, String rel) {
        return guard(t, () -> { activity.treeMkdirs(tree, rel); return true; });
    }

    @JavascriptInterface
    public String treeWrite(String t, String tree, String rel, String data) {
        return guard(t, () -> { activity.treeWrite(tree, rel, b64(data)); return true; });
    }

    /* ---------- שרת הרישוי — הפנייה היחידה לרשת (RelayClient) ---------- */
    @JavascriptInterface
    public String relayPost(String t, int cb, String origin, String body) {
        return guard(t, () -> {
            RelayClient.endpoint(origin); // כתובת לא תקינה — נדחית מיד, בלי חיבור
            activity.relayPost(cb, origin, body);
            return true;
        });
    }

    /* ---------- הדפסה ויציאה ---------- */
    @JavascriptInterface
    public String printHtml(String t, String html, String baseUrl) {
        return guard(t, () -> { activity.printHtml(html, baseUrl); return true; });
    }

    @JavascriptInterface
    public String exit(String t) {
        return guard(t, () -> { activity.runOnUiThread(activity::finishAndRemoveTask); return true; });
    }
}
