package com.bunimseller.supersuite;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * scrypt (RFC 7914) ב-Java טהור — תואם ל-crypto.scryptSync של Node.
 * משמש לגיבוב סיסמאות ולגזירת מפתח הגיבוי (backupCrypto.js) בגרסת אנדרואיד.
 * HMAC נכתב ידנית מעל SHA-256 כדי לתמוך גם בסיסמה ריקה (SecretKeySpec דוחה מפתח ריק).
 */
final class Scrypt {
    private Scrypt() {}

    static byte[] derive(byte[] passwd, byte[] salt, int N, int r, int p, int dkLen) {
        if (N < 2 || (N & (N - 1)) != 0) throw new IllegalArgumentException("N must be a power of 2 greater than 1");
        if (r < 1 || p < 1 || dkLen < 1) throw new IllegalArgumentException("invalid scrypt parameters");
        if ((long) N * r * 128 > 512L * 1024 * 1024) throw new IllegalArgumentException("scrypt memory limit exceeded");
        byte[] B = pbkdf2(passwd, salt, p * 128 * r);
        byte[] XY = new byte[256 * r];
        byte[] V = new byte[128 * r * N];
        for (int i = 0; i < p; i++) smix(B, i * 128 * r, r, N, V, XY);
        return pbkdf2(passwd, B, dkLen);
    }

    /* ---------- PBKDF2-HMAC-SHA256 עם איטרציה אחת (כפי ש-scrypt דורש) ---------- */
    private static byte[] pbkdf2(byte[] passwd, byte[] salt, int dkLen) {
        byte[] out = new byte[dkLen];
        byte[] block = new byte[salt.length + 4];
        System.arraycopy(salt, 0, block, 0, salt.length);
        int blocks = (dkLen + 31) / 32;
        for (int i = 1; i <= blocks; i++) {
            block[salt.length] = (byte) (i >>> 24);
            block[salt.length + 1] = (byte) (i >>> 16);
            block[salt.length + 2] = (byte) (i >>> 8);
            block[salt.length + 3] = (byte) i;
            byte[] u = hmacSha256(passwd, block);
            System.arraycopy(u, 0, out, (i - 1) * 32, Math.min(32, dkLen - (i - 1) * 32));
        }
        return out;
    }

    static byte[] hmacSha256(byte[] key, byte[] msg) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            if (key.length > 64) key = md.digest(key);
            byte[] k = new byte[64];
            System.arraycopy(key, 0, k, 0, key.length);
            byte[] ipad = new byte[64], opad = new byte[64];
            for (int i = 0; i < 64; i++) { ipad[i] = (byte) (k[i] ^ 0x36); opad[i] = (byte) (k[i] ^ 0x5c); }
            md.reset();
            md.update(ipad);
            md.update(msg);
            byte[] inner = md.digest();
            md.update(opad);
            md.update(inner);
            return md.digest();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /* ---------- ליבת scrypt ---------- */
    private static void smix(byte[] B, int Bi, int r, int N, byte[] V, byte[] XY) {
        int Xi = 0;
        int Yi = 128 * r;
        System.arraycopy(B, Bi, XY, Xi, 128 * r);
        for (int i = 0; i < N; i++) {
            System.arraycopy(XY, Xi, V, i * (128 * r), 128 * r);
            blockMixSalsa8(XY, Xi, Yi, r);
        }
        for (int i = 0; i < N; i++) {
            int j = integerify(XY, Xi, r) & (N - 1);
            blockXor(V, j * (128 * r), XY, Xi, 128 * r);
            blockMixSalsa8(XY, Xi, Yi, r);
        }
        System.arraycopy(XY, Xi, B, Bi, 128 * r);
    }

    private static void blockMixSalsa8(byte[] BY, int Bi, int Yi, int r) {
        byte[] X = new byte[64];
        System.arraycopy(BY, Bi + (2 * r - 1) * 64, X, 0, 64);
        for (int i = 0; i < 2 * r; i++) {
            blockXor(BY, Bi + i * 64, X, 0, 64);
            salsa208(X);
            System.arraycopy(X, 0, BY, Yi + i * 64, 64);
        }
        for (int i = 0; i < r; i++) System.arraycopy(BY, Yi + (i * 2) * 64, BY, Bi + i * 64, 64);
        for (int i = 0; i < r; i++) System.arraycopy(BY, Yi + (i * 2 + 1) * 64, BY, Bi + (i + r) * 64, 64);
    }

    private static int rotl(int a, int b) { return (a << b) | (a >>> (32 - b)); }

    private static void salsa208(byte[] B) {
        int[] B32 = new int[16];
        for (int i = 0; i < 16; i++) {
            B32[i] = (B[i * 4] & 0xff) | (B[i * 4 + 1] & 0xff) << 8 | (B[i * 4 + 2] & 0xff) << 16 | (B[i * 4 + 3] & 0xff) << 24;
        }
        int[] x = B32.clone();
        for (int i = 8; i > 0; i -= 2) {
            x[4] ^= rotl(x[0] + x[12], 7);  x[8] ^= rotl(x[4] + x[0], 9);
            x[12] ^= rotl(x[8] + x[4], 13); x[0] ^= rotl(x[12] + x[8], 18);
            x[9] ^= rotl(x[5] + x[1], 7);   x[13] ^= rotl(x[9] + x[5], 9);
            x[1] ^= rotl(x[13] + x[9], 13); x[5] ^= rotl(x[1] + x[13], 18);
            x[14] ^= rotl(x[10] + x[6], 7); x[2] ^= rotl(x[14] + x[10], 9);
            x[6] ^= rotl(x[2] + x[14], 13); x[10] ^= rotl(x[6] + x[2], 18);
            x[3] ^= rotl(x[15] + x[11], 7); x[7] ^= rotl(x[3] + x[15], 9);
            x[11] ^= rotl(x[7] + x[3], 13); x[15] ^= rotl(x[11] + x[7], 18);
            x[1] ^= rotl(x[0] + x[3], 7);   x[2] ^= rotl(x[1] + x[0], 9);
            x[3] ^= rotl(x[2] + x[1], 13);  x[0] ^= rotl(x[3] + x[2], 18);
            x[6] ^= rotl(x[5] + x[4], 7);   x[7] ^= rotl(x[6] + x[5], 9);
            x[4] ^= rotl(x[7] + x[6], 13);  x[5] ^= rotl(x[4] + x[7], 18);
            x[11] ^= rotl(x[10] + x[9], 7); x[8] ^= rotl(x[11] + x[10], 9);
            x[9] ^= rotl(x[8] + x[11], 13); x[10] ^= rotl(x[9] + x[8], 18);
            x[12] ^= rotl(x[15] + x[14], 7); x[13] ^= rotl(x[12] + x[15], 9);
            x[14] ^= rotl(x[13] + x[12], 13); x[15] ^= rotl(x[14] + x[13], 18);
        }
        for (int i = 0; i < 16; i++) B32[i] = x[i] + B32[i];
        for (int i = 0; i < 16; i++) {
            B[i * 4] = (byte) B32[i];
            B[i * 4 + 1] = (byte) (B32[i] >>> 8);
            B[i * 4 + 2] = (byte) (B32[i] >>> 16);
            B[i * 4 + 3] = (byte) (B32[i] >>> 24);
        }
    }

    private static void blockXor(byte[] S, int Si, byte[] D, int Di, int len) {
        for (int i = 0; i < len; i++) D[Di + i] ^= S[Si + i];
    }

    private static int integerify(byte[] B, int Bi, int r) {
        Bi += (2 * r - 1) * 64;
        return (B[Bi] & 0xff) | (B[Bi + 1] & 0xff) << 8 | (B[Bi + 2] & 0xff) << 16 | (B[Bi + 3] & 0xff) << 24;
    }
}
