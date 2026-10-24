"""
encryption.py — הצפנה, פיצול ואחסון סיסמאות לתוכנת ניהול עסקית.

הכול פועל מקומית (ללא רשת). תלויות: cryptography (Fernet) וספריית התקן hashlib.

הערה על "פיצול שלילי": חלוקת הטקסט לחלקים רצופים ולהצפנה של כל חלק בנפרד
אינה מסתירה את המידע — כל חלק לבדו מכיל חלק מהתוכן הגלוי. לכן הפיצול כאן הוא
שיתוף סוד (XOR): n-1 החלקים הראשונים הם רעש אקראי, והחלק האחרון הוא הנתון
מוכפל ב-XOR עם כולם. כל החלקים נדרשים לשחזור, ופחות מ-n חלקים אינם חושפים דבר.
כל חלק מוצפן בנפרד ב-Fernet.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import unicodedata

try:
    from cryptography.fernet import Fernet, InvalidToken
except ModuleNotFoundError as exc:  # pragma: no cover — תלוי בסביבה
    raise ModuleNotFoundError(
        "חסרה הספרייה 'cryptography'. יש להתקין אותה במחשב מסונן:\n"
        "    pip install -r requirements.txt\n"
        "אם ההתקנה נכשלת בגלל הסינון — יש לפנות לספק הסינון שלך."
    ) from exc

# מספר האיטרציות של PBKDF2 (המלצת OWASP לשנת 2023 ל-PBKDF2-HMAC-SHA256)
PBKDF2_ITERATIONS = 600_000
SALT_BYTES = 16
PASSWORD_HASH_ALGO = "pbkdf2_sha256"
# גבולות לאיטרציות שנקראות מהערך המאוחסן: מונע זמן ריצה אינסופי מערך פגום או שהושחת
MIN_ITERATIONS = 100_000
MAX_ITERATIONS = 10_000_000


def _normalize_key(key) -> bytes:
    """מקבלת מפתח כ-bytes או כמחרוזת ומחזירה bytes (מפתח Fernet בקידוד base64)."""
    if isinstance(key, str):
        return key.encode("ascii")
    if isinstance(key, (bytes, bytearray)):
        return bytes(key)
    raise TypeError("המפתח חייב להיות bytes או מחרוזת")


def _normalize_password(password: str) -> bytes:
    """NFC: אותה סיסמה בעברית או בתווים מיוחדים תמיד מתקבלת כרצף בתים זהה."""
    return unicodedata.normalize("NFC", password).encode("utf-8")


def gen_key() -> bytes:
    """יוצרת מפתח הצפנה חדש (Fernet, 32 בייט אקראיים בקידוד base64).

    המפתח חייב להישמר בצורה מאובטחת (למשל במנגנון המפתחות של מערכת ההפעלה).
    אובדן המפתח משמעו אובדן כל הנתונים המוצפנים בו.
    """
    return Fernet.generate_key()


def encrypt_text(text: str, key: bytes) -> str:
    """מצפינה מחרוזת טקסט ומחזירה טוקן מוצפן (מחרוזת ASCII בטוחה לאחסון ב-SQLite).

    פרמטרים:
        text: הטקסט הגלוי (למשל שם לקוח, מספר טלפון או סיסמה לשירות).
        key:  מפתח שנוצר ב-gen_key().
    """
    if not isinstance(text, str):
        raise TypeError("הטקסט להצפנה חייב להיות מחרוזת")
    return Fernet(_normalize_key(key)).encrypt(text.encode("utf-8")).decode("ascii")


def decrypt_text(cipher: str, key: bytes) -> str:
    """מפענחת טוקן שנוצר על ידי encrypt_text ומחזירה את הטקסט המקורי.

    זורקת ValueError אם המפתח שגוי או אם הנתון שונה (בדיקת תקינות מובנית).
    """
    try:
        return Fernet(_normalize_key(key)).decrypt(cipher.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError) as exc:
        raise ValueError("פענוח נכשל: המפתח שגוי או שהנתון פגום") from exc


def _xor_bytes(a: bytes, b: bytes) -> bytes:
    """XOR בית-אחר-בית של שני רצפים באורך זהה."""
    return bytes(x ^ y for x, y in zip(a, b))


# כותרת לכל חלק (בתוך ההצפנה): גרסה, מזהה פיצול אקראי, מספר החלק ומספר החלקים.
# בלעדיה, חלקים משני פיצולים שונים (או חלק כפול) באותו אורך הורכבו בשקט לנתון שגוי.
SHARE_MAGIC = b"SSP2"
SPLIT_ID_BYTES = 16
MAX_PARTS = 255
_HEADER_LEN = len(SHARE_MAGIC) + SPLIT_ID_BYTES + 2


def split_encrypted(secret: str, n_parts: int, key: bytes) -> list[str]:
    """מפצלת נתון רגיש ל-n_parts חלקים מוצפנים, כך שכולם נדרשים לשחזור.

    פרמטרים:
        secret:  הנתון הרגיש (מחרוזת).
        n_parts: מספר החלקים (מספר שלם, 2 עד 255).
        key:     מפתח ההצפנה של Fernet, המשמש להצפנת כל חלק.

    מחזירה: רשימה של n_parts טוקנים מוצפנים. כל חלק נראה כרעש, ושחזור דורש את כולם.
    לכל חלק מצורף (בתוך ההצפנה) מזהה הפיצול ומספר החלק, כדי ש-join_decrypted
    יזהה חלקים מפיצולים שונים או חלק שהוכנס פעמיים.
    """
    if not isinstance(n_parts, int) or isinstance(n_parts, bool) or not 2 <= n_parts <= MAX_PARTS:
        raise ValueError(f"מספר החלקים חייב להיות מספר שלם, בין 2 ל-{MAX_PARTS}")
    data = secret.encode("utf-8")
    shares = [secrets.token_bytes(len(data)) for _ in range(n_parts - 1)]
    last = data
    for share in shares:
        last = _xor_bytes(last, share)
    shares.append(last)
    split_id = secrets.token_bytes(SPLIT_ID_BYTES)
    fernet = Fernet(_normalize_key(key))
    return [
        fernet.encrypt(SHARE_MAGIC + split_id + bytes([index, n_parts]) + share).decode("ascii")
        for index, share in enumerate(shares)
    ]


def join_decrypted(encrypted_parts: list[str], key: bytes, n_parts: int) -> str:
    """מפענחת את כל החלקים שנוצרו על ידי split_encrypted ומרכיבה את הנתון המקורי.

    פרמטרים:
        encrypted_parts: הרשימה שהוחזרה מ-split_encrypted (בכל סדר).
        key:             אותו מפתח ששימש לפיצול.
        n_parts:         מספר החלקים שנוצרו בפיצול.

    זורקת ValueError אם חסר חלק, אם יש יותר מדי חלקים, אם חלק פגום,
    אם החלקים שייכים לפיצולים שונים, או אם אותו חלק הופיע פעמיים.
    """
    if not isinstance(n_parts, int) or isinstance(n_parts, bool) or not 2 <= n_parts <= MAX_PARTS:
        raise ValueError(f"מספר החלקים חייב להיות מספר שלם, בין 2 ל-{MAX_PARTS}")
    if len(encrypted_parts) != n_parts:
        raise ValueError(f"נדרשים {n_parts} חלקים, התקבלו {len(encrypted_parts)}")
    fernet = Fernet(_normalize_key(key))
    plains: list[bytes] = []
    for token in encrypted_parts:
        try:
            plains.append(fernet.decrypt(token.encode("ascii")))
        except (InvalidToken, ValueError, UnicodeError, AttributeError) as exc:
            raise ValueError("חלק אחד או יותר פגום, או שהמפתח שגוי") from exc
    split_ids = set()
    indexes = set()
    shares: list[bytes] = []
    for plain in plains:
        if len(plain) < _HEADER_LEN or not plain.startswith(SHARE_MAGIC):
            raise ValueError("חלק שאינו במבנה של split_encrypted (או מגרסה ישנה)")
        pos = len(SHARE_MAGIC)
        split_ids.add(plain[pos:pos + SPLIT_ID_BYTES])
        index, total = plain[pos + SPLIT_ID_BYTES], plain[pos + SPLIT_ID_BYTES + 1]
        if total != n_parts or index >= n_parts:
            raise ValueError(f"החלק שייך לפיצול של {total} חלקים, ולא של {n_parts}")
        indexes.add(index)
        shares.append(plain[_HEADER_LEN:])
    if len(split_ids) != 1:
        raise ValueError("החלקים שייכים לפיצולים שונים")
    if len(indexes) != n_parts:
        raise ValueError("אותו חלק הופיע יותר מפעם אחת")
    if len({len(s) for s in shares}) != 1:
        raise ValueError("החלקים אינם תואמים לאותו נתון")
    result = shares[0]
    for share in shares[1:]:
        result = _xor_bytes(result, share)
    try:
        return result.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("החלקים אינם תואמים לאותו נתון") from exc


def hash_password(password: str) -> str:
    """מערבלת סיסמה עם salt אקראי באמצעות PBKDF2-HMAC-SHA256.

    מחזירה מחרוזת מהצורה: pbkdf2_sha256$<איטרציות>$<salt>$<hash>
    את המחרוזת הזו שומרים במסד הנתונים. הסיסמה עצמה לא נשמרת לעולם.
    """
    if not isinstance(password, str) or not password:
        raise ValueError("הסיסמה אינה יכולה להיות ריקה")
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", _normalize_password(password), salt, PBKDF2_ITERATIONS)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    hash_b64 = base64.b64encode(digest).decode("ascii")
    return f"{PASSWORD_HASH_ALGO}${PBKDF2_ITERATIONS}${salt_b64}${hash_b64}"


def verify_password(password: str, stored: str) -> bool:
    """בודקת אם סיסמה תואמת לערך המאוחסן (שנוצר על ידי hash_password).

    מחזירה True או False. ערך מאוחסן פגום מחזיר False ולא זורק חריגה.
    ההשוואה נעשית בזמן קבוע (hmac.compare_digest) כדי למנוע דליפת מידע בעיתוי.
    """
    try:
        algo, iterations_str, salt_b64, hash_b64 = stored.split("$")
        if algo != PASSWORD_HASH_ALGO:
            return False
        iterations = int(iterations_str)
        if not MIN_ITERATIONS <= iterations <= MAX_ITERATIONS:
            return False
        salt = base64.b64decode(salt_b64, validate=True)
        expected = base64.b64decode(hash_b64, validate=True)
    except (ValueError, AttributeError):
        return False
    if not isinstance(password, str):
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", _normalize_password(password), salt, iterations)
    return hmac.compare_digest(candidate, expected)


if __name__ == "__main__":
    # דוגמת שימוש: מוודאת שכל הפונקציות עובדות ומדפיסה את התוצאות.
    print("=== 1. הצפנה בסיסית ===")
    key = gen_key()
    token = encrypt_text("יוסי כהן, 050-1234567", key)
    print("טוקן מוצפן:", token[:40] + "...")
    print("מפוענח:", decrypt_text(token, key))
    assert decrypt_text(token, key) == "יוסי כהן, 050-1234567"

    print("\n=== 2. פיצול והרכבה (4 חלקים) ===")
    secret = "מספר כרטיס: 4580-1111-2222-3333"
    parts = split_encrypted(secret, 4, key)
    for i, p in enumerate(parts, 1):
        print(f"חלק {i}: {p[:32]}...")
    restored = join_decrypted(parts, key, 4)
    print("שוחזר:", restored)
    assert restored == secret
    assert join_decrypted(list(reversed(parts)), key, 4) == secret, "הסדר לא משנה"
    try:
        join_decrypted(parts[:3], key, 4)
    except ValueError as exc:
        print("חסר חלק — נדחה כראוי:", exc)

    print("\n=== 3. ערבול ואימות סיסמה ===")
    stored = hash_password("הסוד שלי")
    print("נשמר במסד:", stored[:50] + "...")
    print("סיסמה נכונה:", verify_password("הסוד שלי", stored))
    print("סיסמה שגויה:", verify_password("סיסמה אחרת", stored))
    assert verify_password("הסוד שלי", stored)
    assert not verify_password("סיסמה אחרת", stored)
    assert not verify_password("הסוד שלי", "garbage")

    print("\nהכול עובד.")
