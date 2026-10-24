"""בדיקות ל-encryption.py. להרצה: python -m unittest test_encryption -v"""

import unicodedata
import unittest

import encryption as enc


class TestEncryptText(unittest.TestCase):
    def setUp(self):
        self.key = enc.gen_key()

    def test_roundtrip_hebrew_and_unicode(self):
        for text in ["יוסי כהן", "שלום 🙂", "a" * 10_000, ""]:
            self.assertEqual(enc.decrypt_text(enc.encrypt_text(text, self.key), self.key), text)

    def test_ciphertext_is_nondeterministic(self):
        self.assertNotEqual(enc.encrypt_text("x", self.key), enc.encrypt_text("x", self.key))

    def test_wrong_key_raises_value_error(self):
        token = enc.encrypt_text("secret", self.key)
        with self.assertRaises(ValueError):
            enc.decrypt_text(token, enc.gen_key())

    def test_tampered_token_raises_value_error(self):
        token = enc.encrypt_text("secret", self.key)
        tampered = token[:-2] + ("AA" if token[-2:] != "AA" else "BB")
        with self.assertRaises(ValueError):
            enc.decrypt_text(tampered, self.key)

    def test_non_string_rejected(self):
        with self.assertRaises(TypeError):
            enc.encrypt_text(123, self.key)

    def test_key_accepted_as_str_or_bytes(self):
        key_str = self.key.decode("ascii")
        token = enc.encrypt_text("abc", key_str)
        self.assertEqual(enc.decrypt_text(token, self.key), "abc")

    def test_bad_key_type_rejected(self):
        with self.assertRaises(TypeError):
            enc.encrypt_text("abc", 12345)


class TestSplitJoin(unittest.TestCase):
    def setUp(self):
        self.key = enc.gen_key()
        self.secret = "מספר כרטיס: 4580-1111-2222-3333"

    def test_roundtrip_various_n(self):
        for n in (2, 3, 4, 8):
            parts = enc.split_encrypted(self.secret, n, self.key)
            self.assertEqual(len(parts), n)
            self.assertEqual(enc.join_decrypted(parts, self.key, n), self.secret)

    def test_order_does_not_matter(self):
        parts = enc.split_encrypted(self.secret, 4, self.key)
        self.assertEqual(enc.join_decrypted(list(reversed(parts)), self.key, 4), self.secret)

    def test_missing_part_rejected(self):
        parts = enc.split_encrypted(self.secret, 4, self.key)
        with self.assertRaises(ValueError):
            enc.join_decrypted(parts[:3], self.key, 4)

    def test_extra_part_rejected(self):
        parts = enc.split_encrypted(self.secret, 3, self.key)
        with self.assertRaises(ValueError):
            enc.join_decrypted(parts + [parts[0]], self.key, 3)

    def test_wrong_key_rejected(self):
        parts = enc.split_encrypted(self.secret, 3, self.key)
        with self.assertRaises(ValueError):
            enc.join_decrypted(parts, enc.gen_key(), 3)

    def test_corrupted_part_rejected(self):
        parts = enc.split_encrypted(self.secret, 3, self.key)
        parts[1] = parts[1][:-2] + ("AA" if parts[1][-2:] != "AA" else "BB")
        with self.assertRaises(ValueError):
            enc.join_decrypted(parts, self.key, 3)

    def test_fewer_than_two_parts_rejected(self):
        for n in (0, 1, -3):
            with self.assertRaises(ValueError):
                enc.split_encrypted(self.secret, n, self.key)
        with self.assertRaises(ValueError):
            enc.split_encrypted(self.secret, 2.0, self.key)

    def test_empty_secret(self):
        parts = enc.split_encrypted("", 3, self.key)
        self.assertEqual(enc.join_decrypted(parts, self.key, 3), "")

    def test_single_decrypted_share_is_not_the_secret(self):
        # ההבטחה של שיתוף הסוד: אף חלק בודד (לאחר פענוח) אינו הנתון עצמו
        parts = enc.split_encrypted(self.secret, 3, self.key)
        for p in parts:
            plain = enc.Fernet(self.key).decrypt(p.encode("ascii"))
            self.assertNotEqual(plain, self.secret.encode("utf-8"))
            self.assertNotIn(self.secret.encode("utf-8"), plain)

    # בדיקת קוד 23.10.2026: חלקים מפיצולים שונים באותו אורך הורכבו בשקט לנתון שגוי
    def test_parts_from_different_splits_rejected(self):
        a = enc.split_encrypted("secret-AAAA", 3, self.key)
        b = enc.split_encrypted("secret-BBBB", 3, self.key)
        with self.assertRaises(ValueError):
            enc.join_decrypted([a[0], b[1], a[2]], self.key, 3)

    def test_duplicate_part_rejected(self):
        parts = enc.split_encrypted(self.secret, 3, self.key)
        with self.assertRaises(ValueError):
            enc.join_decrypted([parts[0], parts[0], parts[2]], self.key, 3)

    def test_n_parts_must_match_the_split(self):
        parts = enc.split_encrypted(self.secret, 3, self.key)
        with self.assertRaises(ValueError):
            enc.join_decrypted(parts[:2], self.key, 2)

    def test_token_without_split_header_rejected(self):
        # טוקן Fernet רגיל (או חלק מהגרסה הקודמת, בלי הכותרת) אינו חלק של פיצול
        parts = enc.split_encrypted(self.secret, 2, self.key)
        foreign = enc.Fernet(self.key).encrypt(b"x" * 40).decode("ascii")
        with self.assertRaises(ValueError):
            enc.join_decrypted([parts[0], foreign], self.key, 2)

    def test_too_many_parts_rejected(self):
        with self.assertRaises(ValueError):
            enc.split_encrypted(self.secret, 256, self.key)
        parts = enc.split_encrypted("ab", 255, self.key)
        self.assertEqual(enc.join_decrypted(parts, self.key, 255), "ab")


class TestPasswords(unittest.TestCase):
    def test_hash_and_verify(self):
        stored = enc.hash_password("הסוד שלי")
        self.assertTrue(enc.verify_password("הסוד שלי", stored))
        self.assertFalse(enc.verify_password("סיסמה אחרת", stored))

    def test_salt_makes_hashes_differ(self):
        self.assertNotEqual(enc.hash_password("same"), enc.hash_password("same"))

    def test_unicode_normalization_nfc_vs_nfd(self):
        # אותו תו בשתי צורות יוניקוד (NFC לעומת NFD) צריך להיחשב סיסמה זהה
        nfc = unicodedata.normalize("NFC", "café סיסמה")
        nfd = unicodedata.normalize("NFD", "café סיסמה")
        self.assertNotEqual(nfc, nfd)
        stored = enc.hash_password(nfc)
        self.assertTrue(enc.verify_password(nfd, stored))

    def test_empty_password_rejected(self):
        with self.assertRaises(ValueError):
            enc.hash_password("")

    def test_malformed_stored_values_return_false(self):
        bad = [
            "", "garbage", "pbkdf2_sha256$x$y$z",
            "other_algo$600000$AAAA$AAAA",
            "pbkdf2_sha256$1$AAAA$AAAA",            # איטרציות מתחת לגבול
            "pbkdf2_sha256$999999999999$AAAA$AAAA", # איטרציות מעל הגבול
            "pbkdf2_sha256$600000$!!!$!!!",
        ]
        for value in bad:
            self.assertFalse(enc.verify_password("x", value), value)

    def test_non_string_password_in_verify(self):
        stored = enc.hash_password("abc")
        self.assertFalse(enc.verify_password(None, stored))


if __name__ == "__main__":
    unittest.main()
