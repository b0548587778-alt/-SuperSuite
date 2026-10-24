package com.bunimseller.supersuite;

import android.content.Context;
import android.database.Cursor;
import android.database.CursorWindow;
import android.database.sqlite.SQLiteCursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteProgram;
import android.database.sqlite.SQLiteStatement;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * מקבילה ל-DatabaseSync של node:sqlite מעל SQLite של אנדרואיד.
 * כל הקריאות מגיעות מאותו thread (JavaBridge), ולכן BEGIN/COMMIT דרך execSQL שומרים על טרנזקציה אחת —
 * SQLiteSession של אנדרואיד מתרגם אותם ל-beginTransaction/endTransaction.
 */
final class SqlBridge {
    private final Context context;
    private SQLiteDatabase db;

    SqlBridge(Context context) { this.context = context; }

    void open(String name) {
        if (db != null) return;
        // רק שם הקובץ — הנתיב מגיע מהקוד המשותף ואינו רלוונטי באנדרואיד
        String file = name.replace('\\', '/');
        file = file.substring(file.lastIndexOf('/') + 1);
        if (!file.matches("[A-Za-z0-9_.-]+")) throw new IllegalArgumentException("invalid database name");
        db = SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(file), null);
    }

    private SQLiteDatabase db() {
        if (db == null) throw new IllegalStateException("database is not open");
        return db;
    }

    /** הרצת סקריפט עם כמה פקודות (כמו db.exec ב-Node). execSQL של אנדרואיד מריץ רק פקודה אחת. */
    void exec(String sql) {
        for (String stmt : splitStatements(sql)) {
            String head = stmt.trim().toUpperCase(Locale.ROOT);
            if (head.startsWith("PRAGMA")) { pragma(head); continue; }
            if (head.startsWith("SELECT") || head.startsWith("WITH")) {
                Cursor c = db().rawQuery(stmt, null);
                try { c.moveToFirst(); } finally { c.close(); }
                continue;
            }
            db().execSQL(stmt);
        }
    }

    private void pragma(String upper) {
        String compact = upper.replace(" ", "");
        if (compact.startsWith("PRAGMAFOREIGN_KEYS=")) {
            boolean on = compact.endsWith("=ON") || compact.endsWith("=1") || compact.endsWith("=TRUE");
            try { db().setForeignKeyConstraintsEnabled(on); } catch (IllegalStateException ignored) { /* בתוך טרנזקציה */ }
            return;
        }
        // journal_mode: אנדרואיד מנהל את מצב היומן בעצמו; שאר ה-PRAGMA לא בשימוש בקוד
    }

    void run(String sql, String paramsJson) throws JSONException {
        SQLiteStatement st = db().compileStatement(sql);
        try {
            bind(st, new JSONArray(paramsJson));
            st.execute();
        } finally {
            st.close();
        }
    }

    JSONArray all(String sql, String paramsJson) throws JSONException {
        final JSONArray params = new JSONArray(paramsJson);
        final JSONException[] bindError = new JSONException[1];
        Cursor c = db().rawQueryWithFactory((database, driver, editTable, query) -> {
            try { bind(query, params); } catch (JSONException e) { bindError[0] = e; }
            SQLiteCursor cursor = new SQLiteCursor(driver, editTable, query);
            // אוסף שלם נשמר כשורה אחת (JSON) — חלון ברירת המחדל (2MB) קטן מדי לנתונים גדולים.
            // הבנאי עם גודל קיים מ-API 28, ולכן minSdk הוא 28 (android/build-apk.js — MIN_SDK)
            cursor.setWindow(new CursorWindow("supersuite", 64L * 1024 * 1024));
            return cursor;
        }, sql, null, null);
        try {
            if (bindError[0] != null) throw bindError[0];
            JSONArray rows = new JSONArray();
            String[] cols = c.getColumnNames();
            while (c.moveToNext()) {
                JSONObject row = new JSONObject();
                for (int i = 0; i < cols.length; i++) {
                    switch (c.getType(i)) {
                        case Cursor.FIELD_TYPE_NULL: row.put(cols[i], JSONObject.NULL); break;
                        case Cursor.FIELD_TYPE_INTEGER: row.put(cols[i], c.getLong(i)); break;
                        case Cursor.FIELD_TYPE_FLOAT: row.put(cols[i], c.getDouble(i)); break;
                        case Cursor.FIELD_TYPE_BLOB: row.put(cols[i], Base64.encodeToString(c.getBlob(i), Base64.NO_WRAP)); break;
                        default: row.put(cols[i], c.getString(i));
                    }
                }
                rows.put(row);
            }
            return rows;
        } finally {
            c.close();
        }
    }

    /** פרמטרים עם סוג: {t:'n'|'i'|'f'|'s'|'b', v} — כך מספר נשמר כמספר ולא כטקסט. */
    private static void bind(SQLiteProgram p, JSONArray params) throws JSONException {
        for (int i = 0; i < params.length(); i++) {
            JSONObject o = params.getJSONObject(i);
            int idx = i + 1;
            switch (o.getString("t")) {
                case "n": p.bindNull(idx); break;
                case "i": p.bindLong(idx, Long.parseLong(o.getString("v"))); break;
                case "f": p.bindDouble(idx, o.getDouble("v")); break;
                case "b": p.bindBlob(idx, Base64.decode(o.getString("v"), Base64.NO_WRAP)); break;
                default: p.bindString(idx, o.getString("v"));
            }
        }
    }

    /** פיצול לפי ';' מחוץ למחרוזות ולהערות. */
    static List<String> splitStatements(String sql) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        int n = sql.length();
        for (int i = 0; i < n; i++) {
            char ch = sql.charAt(i);
            if (ch == '\'' || ch == '"' || ch == '`') {
                int j = i + 1;
                while (j < n) {
                    if (sql.charAt(j) == ch) {
                        if (j + 1 < n && sql.charAt(j + 1) == ch) { j += 2; continue; }
                        break;
                    }
                    j++;
                }
                cur.append(sql, i, Math.min(j + 1, n));
                i = j;
            } else if (ch == '-' && i + 1 < n && sql.charAt(i + 1) == '-') {
                while (i < n && sql.charAt(i) != '\n') i++;
                cur.append('\n');
            } else if (ch == ';') {
                if (cur.toString().trim().length() > 0) out.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(ch);
            }
        }
        if (cur.toString().trim().length() > 0) out.add(cur.toString());
        return out;
    }
}
