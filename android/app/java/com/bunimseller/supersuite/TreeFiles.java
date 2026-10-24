package com.bunimseller.supersuite;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * כתיבה לתיקייה שהמשתמש בחר בבוחר התיקיות (ACTION_OPEN_DOCUMENT_TREE) — למשל קבצים במבנה אחיד
 * (OPENFRMT/<עוסק>.<שנה>/<MMDDhhmm>/INI.TXT ו-BKMVDATA.zip). נתיב יחסי בלבד, בלי ".." — רק בתוך התיקייה שנבחרה.
 */
final class TreeFiles {
    private static final String[] COLUMNS = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME};
    private final ContentResolver resolver;

    TreeFiles(ContentResolver resolver) { this.resolver = resolver; }

    static List<String> segments(String rel) {
        List<String> out = new ArrayList<>();
        for (String s : (rel == null ? "" : rel).split("/")) {
            if (s.isEmpty() || s.equals(".")) continue;
            if (s.equals("..") || s.indexOf('\\') >= 0 || s.indexOf('\0') >= 0) throw new IllegalArgumentException("נתיב לא תקין");
            out.add(s);
        }
        return out;
    }

    private static Uri root(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private Uri child(Uri tree, Uri parent, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent));
        try (Cursor c = resolver.query(children, COLUMNS, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
            }
        }
        return null;
    }

    boolean exists(Uri tree, String rel) {
        Uri cur = root(tree);
        for (String s : segments(rel)) {
            cur = child(tree, cur, s);
            if (cur == null) return false;
        }
        return true;
    }

    private Uri dirs(Uri tree, List<String> segs) throws Exception {
        Uri cur = root(tree);
        for (String s : segs) {
            Uri next = child(tree, cur, s);
            if (next == null) next = DocumentsContract.createDocument(resolver, cur, DocumentsContract.Document.MIME_TYPE_DIR, s);
            if (next == null) throw new IllegalStateException("לא ניתן ליצור את התיקייה " + s);
            cur = next;
        }
        return cur;
    }

    void mkdirs(Uri tree, String rel) throws Exception { dirs(tree, segments(rel)); }

    void write(Uri tree, String rel, byte[] data) throws Exception {
        List<String> segs = segments(rel);
        if (segs.isEmpty()) throw new IllegalArgumentException("נתיב לא תקין");
        String name = segs.remove(segs.size() - 1);
        Uri dir = dirs(tree, segs);
        Uri file = child(tree, dir, name);
        // application/octet-stream — ספק המסמכים לא משנה את השם ולא מוסיף סיומת (INI.TXT, BKMVDATA.zip)
        if (file == null) file = DocumentsContract.createDocument(resolver, dir, "application/octet-stream", name);
        if (file == null) throw new IllegalStateException("לא ניתן ליצור את הקובץ " + name);
        try (OutputStream out = resolver.openOutputStream(file, "wt")) {
            if (out == null) throw new IllegalStateException("לא ניתן לפתוח את הקובץ לכתיבה");
            out.write(data);
        }
    }
}
