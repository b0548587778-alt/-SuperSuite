// Core Database Module - Unified Data Access Layer
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite'); // SQLite מובנה ב-Node/Electron — בלי מודול native
const AR = require('./atRest');

// Collections definition - unified schema from all projects
const collections = [
  'records',           // Financial records (income/expense)
  'contacts',          // Contact information
  'suppliers',         // Supplier information
  'clients',           // Client/Customer information
  'budgets',           // Budget planning
  'cashFlow',          // Cash flow tracking
  'businessPlans',     // Business plans
  'donors',            // Donor information (NGO)
  'donations',         // Donation records
  'tasks',             // Task management
  'documents',         // Document storage
  'users',             // User accounts
  'roles',             // Role-based access control
  'permissions',       // Permission definitions
  'auditLogs',         // Audit trail
  'marketIntel',       // Market intelligence
  'personalFinance',   // Personal financial plans
  'mortgageScenarios', // Mortgage/loan scenarios
  'canvasBoards',      // Kanban/whiteboard
  'fitnessData',       // Health & fitness tracking
  'voiceNotes',        // Voice notes/audio memos
  'accounts',          // Chart of accounts (תוכנית חשבונות)
  'journal',           // Double-entry journal (יומן)
  'invoices',          // Sales invoices (חשבוניות מס)
  'salesDocs',         // מסמכי מכירה נוספים: הצעת מחיר, הזמנה, תעודת משלוח, זיכוי, קבלה (core/salesDocs.js)
  'bankLines',         // תנועות מדף בנק שנקלטו מקובץ והתאמתן (core/bankReconcile.js)
  'recurringInvoices', // תבניות לחשבונית חוזרת חודשית — הטיוטות מחושבות, לא נשמרות (core/recurring.js)
  'products',          // Price list: products and services (מחירון)
  'personal',          // Personal/family income & expenses — נפרד לחלוטין מהיומן העסקי
  'npo',               // עמותה: תרומות וקבלות, קרנות, תמיכות — נפרד מהיומן העסקי
  'gemach',            // קופת גמ"ח: הלוואות ללא ריבית, ערבים, הפקדות — נפרד מהעמותה ומהיומן העסקי
  'chesed',            // חסד וחלוקות: נזקקים (כולל חסויים), מתנדבים וסבבי חלוקה
  'mortgageAdvisor',   // ייעוץ משכנתאות: תיקי לקוחות והצעות בנקים
  'realty',            // נדל"ן ותיווך: נכסים, לקוחות ועסקאות (core/realty.js)
  'mortgageLab',       // מעבדת תמהיל: תחזית, אימותי כללים ותרחישים שמורים
  'realEstate',        // שמאות מקרקעין: תיקי שומה, עסקאות השוואה ופרטי השמאי (core/realEstateAppraisal.js)
  'realEstatePhotos',  // צילומים לתיקי השומה — אוסף נפרד ומוגבל בגודל (כל שמירה כותבת את כל האוספים)
  'payments',          // גבייה מלקוחות: דרישות תשלום וקישורים לחברת הסליקה של הארגון — בלי פרטי אשראי
  'privacy'            // תיקון 13: יומן בקשות עיון ותיקון של נושאי מידע
];

const objectCollections = new Set([
  'marketIntel',
  'personalFinance',
  'mortgageScenarios',
  'canvasBoards',
  'fitnessData',
  'voiceNotes',
  'npo',
  'gemach',
  'chesed',
  'mortgageAdvisor',
  'realty',
  'mortgageLab',
  'realEstate',
  'realEstatePhotos',
  'payments',
  'privacy'
]);

const defaults = {
  version: 4,
  organization: { name: 'המערכת המאוחדת', type: 'ארגון' },
  records: [],
  contacts: [],
  suppliers: [],
  clients: [],
  budgets: [],
  cashFlow: [],
  businessPlans: [],
  donors: [],
  donations: [],
  tasks: [],
  documents: [],
  users: [],
  roles: [],
  permissions: [],
  auditLogs: [],
  marketIntel: { userId: '', entries: [] },
  personalFinance: { userId: '', planName: '', currency: 'ILS', incomes: [], expenses: [], investments: [], cashFlowEntries: [] },
  mortgageScenarios: { userId: '', scenarios: [] },
  canvasBoards: { userId: '', boards: [] },
  fitnessData: { userId: '', workouts: [], nutrition: [], metrics: [] },
  voiceNotes: { userId: '', notes: [] },
  accounts: [],
  journal: [],
  invoices: [],
  salesDocs: [],
  recurringInvoices: [],
  bankLines: [],
  products: [],
  personal: [],
  npo: { settings: {}, donations: [], grants: [], standingOrders: [], memorials: [], campaigns: [] },
  gemach: { settings: {}, loans: [], deposits: [], applications: [], items: [], lendings: [] },
  chesed: { beneficiaries: [], volunteers: [], rounds: [] },
  mortgageAdvisor: { clients: [], offers: [] },
  realty: { properties: [], clients: [], deals: [] },
  mortgageLab: { forecast: null, verifications: [], scenarios: [], rateConvention: 'NOMINAL' },
  realEstate: { cases: [], seq: 0, settings: {} },
  realEstatePhotos: { photos: [] },
  payments: { settings: {}, requests: [] },
  privacy: { requests: [] },
  settings: { currency: 'ILS', vatRate: 0.18 }
};

const actionPermissions = [
  'data.view', 'data.create', 'data.edit', 'data.delete',
  'data.export', 'data.backup', 'data.restore', 'users.manage'
];

const migrations = [
  {
    version: 1,
    sql: 'CREATE TABLE IF NOT EXISTS collections (collection TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)'
  },
  {
    version: 2,
    sql: 'CREATE INDEX IF NOT EXISTS idx_collections_updated_at ON collections(updated_at)'
  },
  {
    version: 3,
    sql: 'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
  },
  {
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at)`
  },
  {
    version: 5,
    sql: `INSERT OR IGNORE INTO roles (id, name) VALUES ('admin', 'admin');
          INSERT OR IGNORE INTO permissions (id, name) VALUES ${actionPermissions.map(p => `('${p}', '${p}')`).join(', ')};
          INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'admin', id FROM permissions WHERE name IN (${actionPermissions.map(p => `'${p}'`).join(', ')})`
  },
  {
    version: 6,
    sql: 'SELECT 1'
  },
  {
    version: 7,
    sql: `INSERT OR IGNORE INTO roles (id, name) VALUES ('editor', 'editor'), ('viewer', 'viewer');
          INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'editor', id FROM permissions WHERE name IN ('data.view', 'data.create', 'data.edit', 'data.export', 'data.backup');
          INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'viewer', id FROM permissions WHERE name IN ('data.view')`
  },
  {
    // רואה חשבון: צפייה וייצוא בלבד — בלי עריכה, מחיקה, גיבוי/שחזור או ניהול משתמשים.
    // נזקק חסוי מוסתר ממנו כמו מכל מי שאין לו users.manage
    version: 8,
    sql: `INSERT OR IGNORE INTO roles (id, name) VALUES ('accountant', 'accountant');
          INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'accountant', id FROM permissions WHERE name IN ('data.view', 'data.export')`
  },
  {
    // קישור משתמש מקומי לחשבון Google (כניסה נוספת — לא מחליפה את הסיסמה). נשמרת רק הזהות, בלי אסימונים
    version: 9,
    sql: `CREATE TABLE IF NOT EXISTS auth_google_links (
      user_id TEXT PRIMARY KEY,
      google_sub TEXT NOT NULL UNIQUE,
      email TEXT,
      linked_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
    )`
  }
];

const ROLES = ['admin', 'editor', 'viewer', 'accountant'];

const PASSWORD_MIN_LENGTH = 12;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

class Database {
  // resolveCipher({ hasSealedData, verify }) ← { key, status } (PLAN.md 3.1). בלי — הנתונים נשמרים גלויים כמו פעם.
  // beforeEncrypt(db) — גיבוי לפני ההמרה החד-פעמית; אם נכשל, ההמרה נדחית להפעלה הבאה
  constructor(dbPath, { resolveCipher, beforeEncrypt } = {}) {
    this.dbPath = dbPath;
    this.db = null;
    this.cipher = AR.createCipher(null);
    this.atRestStatus = 'plain';
    this._resolveCipher = resolveCipher;
    this._beforeEncrypt = beforeEncrypt;
  }

  // כל כשל בפתיחה (מסד פגום, נעול, בלי מפתח) סוגר את הקובץ — אחרת ב-Windows אי אפשר להעביר אותו הצידה (PLAN.md 2.3)
  async initialize() {
    try { await this._open(); }
    catch (e) { if (this.db) { try { this.db.close(); } catch {} } this.db = null; throw e; }
  }

  async _open() {
    // Ensure directory exists
    const userDataPath = path.dirname(this.dbPath);
    fs.mkdirSync(userDataPath, { recursive: true });

    // Initialize SQLite database (node:sqlite, synchronous API wrapped in promises)
    this.db = new DatabaseSync(this.dbPath);
    const self = this;
    this.run = (sql, params = []) => new Promise((resolve, reject) => {
      try { self.db.prepare(sql).run(...params); resolve(self); } catch (err) { reject(err); }
    });
    this.all = (sql, params = []) => new Promise((resolve, reject) => {
      try { resolve(self.db.prepare(sql).all(...params).map(r => ({ ...r }))); } catch (err) { reject(err); }
    });
    this.exec = (sql) => new Promise((resolve, reject) => {
      try { self.db.exec(sql); resolve(); } catch (err) { reject(err); }
    });

    // Create migration bookkeeping before the first migration run.
    await this.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    await this.run('CREATE TABLE IF NOT EXISTS collections (collection TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)');

    // Run migrations
    await this.migrate();

    // המפתח נבחר לפני כל קריאה או כתיבה של נתונים
    await this._setupCipher();

    // Initialize with default data if empty
    await this.initializeDefaults();

    await this._encryptExisting();
  }

  // ערך מוצפן כלשהו מהמסד — כדי לבדוק שהמפתח מתאים לפני שמשתמשים בו
  async _sealedSample() {
    const rows = await this.all("SELECT payload AS v FROM collections WHERE payload LIKE 'SSDB1:%' LIMIT 1");
    if (rows.length) return rows[0].v;
    const audit = await this.all("SELECT details AS v FROM audit_events WHERE details LIKE 'SSDB1:%' LIMIT 1");
    return audit.length ? audit[0].v : null;
  }

  async _setupCipher() {
    const sample = await this._sealedSample();
    if (!this._resolveCipher) {
      if (sample) throw Object.assign(new Error('הנתונים מוצפנים, ומפתח ההצפנה אינו זמין'), { code: 'db-key-missing' });
      return;
    }
    const verify = (key) => { try { AR.createCipher(key).open(sample); return true; } catch { return false; } };
    const r = await this._resolveCipher({ hasSealedData: !!sample, verify });
    if (!r || !r.key) {
      if (sample) throw Object.assign(new Error('הנתונים מוצפנים. בלי קוד השחזור (🔑) או גיבוי אי אפשר לפתוח אותם'), { code: 'db-key-missing' });
      this.atRestStatus = (r && r.status) || 'plain';
      return;
    }
    this.cipher = AR.createCipher(r.key);
    this.atRestStatus = 'encrypted';
  }

  // המרה חד-פעמית של מסד ישן (גם ערכים גלויים שנשארו): גיבוי ← טרנזקציה אחת ← VACUUM
  async _encryptExisting() {
    if (!this.cipher.enabled) return { converted: false };
    const plain = await this.all("SELECT COUNT(*) AS n FROM collections WHERE payload NOT LIKE 'SSDB1:%'");
    const plainAudit = await this.all("SELECT COUNT(*) AS n FROM audit_events WHERE details IS NOT NULL AND details <> '' AND details NOT LIKE 'SSDB1:%'");
    if (!plain[0].n && !plainAudit[0].n) return { converted: false };
    if (this._beforeEncrypt) {
      try { await this._beforeEncrypt(this); }
      catch (e) {
        // בלי גיבוי לא ממירים. הכתיבה בהפעלה הזו נשארת גלויה, ונסיון נוסף בהפעלה הבאה
        this.cipher = AR.createCipher(null);
        this.atRestStatus = 'pending-backup';
        this.atRestError = e;
        return { converted: false, reason: 'backup-failed' };
      }
    }
    await this.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (const row of await this.all("SELECT collection, payload FROM collections WHERE payload NOT LIKE 'SSDB1:%'")) {
        await this.run('UPDATE collections SET payload = ? WHERE collection = ?', [this.cipher.seal(row.payload), row.collection]);
      }
      for (const row of await this.all("SELECT id, details FROM audit_events WHERE details IS NOT NULL AND details <> '' AND details NOT LIKE 'SSDB1:%'")) {
        await this.run('UPDATE audit_events SET details = ? WHERE id = ?', [this.cipher.seal(row.details), row.id]);
      }
      await this.exec('COMMIT');
    } catch (error) {
      await this.exec('ROLLBACK');
      throw error;
    }
    // בניית הקובץ מחדש: בלי זה נשארים בדפים הפנויים של הקובץ (וביומן WAL) עותקים גלויים ישנים
    await this.exec('VACUUM');
    await this.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { converted: true };
  }

  async migrate() {
    await this.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = await this.all('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(applied.map(row => row.version));

    await this.exec('BEGIN IMMEDIATE TRANSACTION');

    try {
      for (const migration of migrations) {
        if (appliedVersions.has(migration.version)) continue;
        await this.exec(migration.sql);
        await this.run('INSERT INTO schema_migrations VALUES (?, ?)', [migration.version, new Date().toISOString()]);
      }
      await this.exec('COMMIT');
    } catch (error) {
      await this.exec('ROLLBACK');
      throw error;
    }
  }

  async initializeDefaults() {
    await this.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await this.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    await this.run('CREATE TABLE IF NOT EXISTS collections (collection TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)');
    await this.migrate();

    const rows = await this.all('SELECT collection FROM collections');
    if (rows.length === 0) {
      let legacy = defaults;
      try {
        legacy = JSON.parse(fs.readFileSync(path.join(path.dirname(this.dbPath), 'system-data.json'), 'utf8'));
      } catch (err) {
        // Ignore if legacy file doesn't exist
      }
      await this.save(isValidData(legacy) ? legacy : defaults);
    }
  }

  async load() {
    const rows = await this.all('SELECT collection, payload FROM collections');
    const data = { ...defaults };

    for (const row of rows) {
      try {
        const payload = JSON.parse(this.cipher.open(row.payload));
        if (row.collection === 'meta') {
          Object.assign(data, payload);
        } else {
          data[row.collection] = payload;
        }
      } catch (err) {
        if (err && String(err.code || '').startsWith('db-key')) throw err; // מפתח שגוי — לא מציגים נתונים ריקים
        if (row.collection !== 'meta') {
          data[row.collection] = [];
        }
      }
    }

    return normalizeData(data);
  }

  async save(value) {
    if (!isValidData(value)) {
      throw new Error('הנתונים אינם תקינים');
    }

    const data = normalizeData(value);
    await this.exec('BEGIN IMMEDIATE TRANSACTION');

    try {
      await this.run('DELETE FROM collections');
      for (const collection of collections) {
        await this.run(
          'INSERT INTO collections VALUES (?, ?, ?)',
          [collection, this.cipher.seal(JSON.stringify(data[collection])), new Date().toISOString()]
        );
      }
      await this.run(
        'INSERT INTO collections VALUES (?, ?, ?)',
        ['meta', this.cipher.seal(JSON.stringify({
          version: data.version,
          organization: data.organization,
          settings: data.settings
        })), new Date().toISOString()]
      );
      await this.exec('COMMIT');
    } catch (error) {
      await this.exec('ROLLBACK');
      throw error;
    }

    return data;
  }

  async setupAdmin(username, password) {
    validateCredentials(username, password);
    const existing = await this.all('SELECT id FROM auth_users LIMIT 1');
    if (existing.length) {
      throw new Error('כבר קיים מנהל במערכת');
    }

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();

    await this.run('INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)', ['admin', 'admin']);
    await this.run(
      'INSERT INTO auth_users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [userId, username, hashPassword(password), now, now]
    );
    await this.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, 'admin']);

    return {
      id: userId,
      username,
      roles: ['admin'],
      permissions: [...actionPermissions]
    };
  }

  async authenticate(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new Error('שם משתמש או סיסמה שגויים');
    }

    const rows = await this.all('SELECT * FROM auth_users WHERE username = ? AND active = 1', [username]);
    const user = rows[0];
    if (!user) {
      throw new Error('שם משתמש או סיסמה שגויים');
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new Error('החשבון ננעל זמנית עקב ניסיונות כניסה כושלים — נסה שוב בעוד 15 דקות');
    }

    if (!verifyPassword(password, user.password_hash)) {
      const failedAttempts = user.failed_attempts + 1;
      const lockedUntil = failedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MS).toISOString()
        : null;

      await this.run(
        'UPDATE auth_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?',
        [failedAttempts, lockedUntil, new Date().toISOString(), user.id]
      );
      throw new Error('שם משתמש או סיסמה שגויים');
    }

    await this.run(
      'UPDATE auth_users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), user.id]
    );

    return this._sessionUser(user);
  }

  // המשתמש כפי שנשמר בפגישה: תפקידים והרשאות נטענים מחדש בכל כניסה
  async _sessionUser(user) {
    const roles = await this.all(
      'SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?',
      [user.id]
    );

    const permissions = await this.all(
      'SELECT DISTINCT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id ' +
      'JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?',
      [user.id]
    );

    return {
      id: user.id,
      username: user.username,
      roles: roles.map(r => r.name),
      permissions: permissions.map(p => p.name)
    };
  }

  // ---------- כניסה עם Google ----------
  // הזהות (sub) כבר אומתה מול Google; כאן רק מאתרים את המשתמש המקושר. חסום/נעול — אין כניסה
  async authenticateGoogle(sub) {
    if (typeof sub !== 'string' || !sub) throw new Error('חשבון Google לא מקושר לאף משתמש');
    const rows = await this.all(
      'SELECT u.* FROM auth_users u JOIN auth_google_links g ON g.user_id = u.id WHERE g.google_sub = ?', [sub]);
    const user = rows[0];
    if (!user) throw new Error('חשבון ה-Google הזה לא מקושר לאף משתמש. היכנסו בסיסמה וקשרו אותו בהגדרות');
    if (!user.active) throw new Error('המשתמש חסום');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new Error('החשבון ננעל זמנית עקב ניסיונות כניסה כושלים — נסה שוב בעוד 15 דקות');
    }
    return this._sessionUser(user);
  }

  async linkGoogle(userId, { sub, email } = {}) {
    if (typeof sub !== 'string' || !sub || sub.length > 255) throw new Error('תשובת Google אינה תקינה');
    const other = await this.all('SELECT user_id FROM auth_google_links WHERE google_sub = ? AND user_id <> ?', [sub, userId]);
    if (other.length) throw new Error('חשבון ה-Google הזה כבר מקושר למשתמש אחר');
    const now = new Date().toISOString();
    await this.run('INSERT OR REPLACE INTO auth_google_links (user_id, google_sub, email, linked_at) VALUES (?, ?, ?, ?)',
      [userId, sub, String(email || '').slice(0, 254), now]);
    return { email: String(email || ''), linkedAt: now };
  }

  async unlinkGoogle(userId) {
    await this.run('DELETE FROM auth_google_links WHERE user_id = ?', [userId]);
    return true;
  }

  async googleLinkOf(userId) {
    const rows = await this.all('SELECT email, linked_at FROM auth_google_links WHERE user_id = ?', [userId]);
    return rows[0] ? { email: rows[0].email || '', linkedAt: rows[0].linked_at } : null;
  }

  async changePassword(userId, currentPassword, newPassword) {
    validateCredentials('valid-user', newPassword);
    const rows = await this.all('SELECT password_hash FROM auth_users WHERE id = ? AND active = 1', [userId]);
    if (!rows[0] || !verifyPassword(currentPassword, rows[0].password_hash)) {
      throw new Error('הסיסמה הנוכחית שגויה');
    }

    await this.run(
      'UPDATE auth_users SET password_hash = ?, updated_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?',
      [hashPassword(newPassword), new Date().toISOString(), userId]
    );

    return true;
  }

  async hasUsers() {
    const rows = await this.all('SELECT 1 FROM auth_users LIMIT 1');
    return rows.length > 0;
  }

  async userHasPermission(userId, permission) {
    const rows = await this.all(
      'SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id ' +
      'JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ? AND p.name = ? LIMIT 1',
      [userId, permission]
    );
    return rows.length > 0;
  }

  async audit(userId, action, details = '') {
    await this.run(
      'INSERT INTO audit_events (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), userId || null, action, details ? this.cipher.seal(details) : details, new Date().toISOString()]
    );
  }

  // גיבוי: כל האוספים שברשימה, בלי רשימה ידנית — אוסף חדש נכנס לגיבוי המוצפן אוטומטית
  async backup() {
    const data = await this.load();
    const out = { version: data.version, organization: data.organization, settings: data.settings };
    for (const c of collections) out[c] = data[c];
    out.exportedAt = new Date().toISOString();
    return out;
  }

  // ---------- ניהול משתמשים (הגדרות מתקדמות) ----------
  async listUsers() {
    const rows = await this.all(
      'SELECT u.id, u.username, u.active, u.created_at, u.locked_until, g.email AS google_email, ' +
      "(SELECT GROUP_CONCAT(role_id) FROM user_roles ur WHERE ur.user_id = u.id) AS roles FROM auth_users u " +
      'LEFT JOIN auth_google_links g ON g.user_id = u.id ORDER BY u.created_at'
    );
    return rows.map(r => ({ id: r.id, username: r.username, active: !!r.active, createdAt: r.created_at, google: r.google_email || null,
      locked: !!(r.locked_until && new Date(r.locked_until) > new Date()), role: String(r.roles || '').split(',')[0] || 'viewer' }));
  }

  async _activeAdmins() {
    const rows = await this.all("SELECT u.id FROM auth_users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role_id = 'admin' AND u.active = 1");
    return rows.map(r => r.id);
  }

  async createUser(username, password, role) {
    validateCredentials(username, password);
    if (!ROLES.includes(role)) throw new Error('תפקיד לא מוכר');
    const exists = await this.all('SELECT 1 FROM auth_users WHERE username = ?', [username]);
    if (exists.length) throw new Error('שם המשתמש כבר קיים');
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await this.run('INSERT INTO auth_users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, username, hashPassword(password), now, now]);
    await this.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, role]);
    return { id, username, role, active: true };
  }

  // שינוי תפקיד/הפעלה: אסור להשאיר את המערכת בלי מנהל פעיל
  async updateUser(id, { role, active } = {}) {
    const rows = await this.all('SELECT id FROM auth_users WHERE id = ?', [id]);
    if (!rows.length) throw new Error('המשתמש לא נמצא');
    const admins = await this._activeAdmins();
    const losesAdmin = admins.includes(id) && ((role && role !== 'admin') || active === false);
    if (losesAdmin && admins.length <= 1) throw new Error('לא ניתן להסיר את המנהל הפעיל האחרון');
    if (role !== undefined) {
      if (!ROLES.includes(role)) throw new Error('תפקיד לא מוכר');
      await this.run('DELETE FROM user_roles WHERE user_id = ?', [id]);
      await this.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, role]);
    }
    if (active !== undefined) await this.run('UPDATE auth_users SET active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, new Date().toISOString(), id]);
    return (await this.listUsers()).find(u => u.id === id);
  }

  // איפוס סיסמה ע"י מנהל: גם משחרר נעילה
  async resetPassword(id, newPassword) {
    validateCredentials('valid-user', newPassword);
    const rows = await this.all('SELECT id FROM auth_users WHERE id = ?', [id]);
    if (!rows.length) throw new Error('המשתמש לא נמצא');
    await this.run('UPDATE auth_users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [hashPassword(newPassword), new Date().toISOString(), id]);
    return true;
  }

  async listAudit({ limit = 200, action = '' } = {}) {
    const lim = Math.min(Math.max(1, Number(limit) || 200), 5000);
    const rows = await this.all(
      'SELECT a.created_at, a.action, a.details, u.username FROM audit_events a LEFT JOIN auth_users u ON u.id = a.user_id ' +
      (action ? 'WHERE a.action LIKE ? ' : '') + 'ORDER BY a.created_at DESC LIMIT ?',
      action ? [String(action).slice(0, 60) + '%', lim] : [lim]
    );
    return rows.map(r => ({ at: r.created_at, action: r.action, details: r.details ? this._openDetails(r.details) : '', user: r.username || '' }));
  }

  // שורה ביומן שלא נפתחת לא מפילה את כל היומן
  _openDetails(text) {
    try { return this.cipher.open(text); } catch { return '(מוצפן)'; }
  }

  async restore(backupData) {
    if (!backupData || typeof backupData !== 'object') {
      throw new Error('קובץ הגיבוי אינו תקין');
    }

    const data = normalizeData(backupData);
    // מונים של מסמכים ממוספרים לא חוזרים אחורה (דוח הבדיקה, ממצא 4): גיבוי ישן לא מחזיר מספר שכבר נמסר ללקוח,
    // דווח לרשות המסים או נשלח לבנק. מסד ריק (שחזור אחרי תקלה) — אין מה לשמור
    let current = null;
    try { current = await this.load(); } catch { /* מסד שלא נפתח — משחזרים כמו שהוא */ }
    if (current) keepCounters(data, current);
    await this.save(data);
    return true;
  }

  async getRecords(filters = {}) {
    const data = await this.load();
    let records = data.records || [];

    if (filters.type) {
      records = records.filter(r => r.type === filters.type);
    }
    if (filters.category) {
      records = records.filter(r => r.category === filters.category);
    }
    if (filters.clientId) {
      records = records.filter(r => r.clientId === filters.clientId);
    }
    if (filters.supplierId) {
      records = records.filter(r => r.supplierId === filters.supplierId);
    }
    if (filters.startDate) {
      records = records.filter(r => new Date(r.date) >= new Date(filters.startDate));
    }
    if (filters.endDate) {
      records = records.filter(r => new Date(r.date) <= new Date(filters.endDate));
    }

    return records;
  }

  async createRecord(recordData) {
    if (!recordData.name || typeof recordData.name !== 'string') {
      throw new Error('שם הרשומה חובה');
    }

    const amount = Number(recordData.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('סכום לא תקין');
    }

    const vat = recordData.vat ? Number(recordData.vat) : 0;
    if (!Number.isFinite(vat) || vat < 0) {
      throw new Error('מע"מ לא תקין');
    }

    if (!recordData.date || !/^\d{4}-\d{2}-\d{2}$/.test(recordData.date)) {
      throw new Error('תאריך לא תקין');
    }

    const record = {
      id: crypto.randomUUID(),
      type: recordData.type || 'income',
      name: recordData.name.trim(),
      amount,
      vat,
      date: recordData.date,
      category: recordData.category || null,
      clientId: recordData.clientId || null,
      supplierId: recordData.supplierId || null,
      account: recordData.account || null,
      paymentMethod: recordData.paymentMethod || null,
      notes: recordData.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const data = await this.load();
    data.records.push(record);
    await this.save(data);

    return record;
  }

  async updateRecord(recordId, updates) {
    const data = await this.load();
    const record = data.records.find(r => r.id === recordId);
    if (!record) {
      throw new Error('הרשומה לא נמצאה');
    }

    if (updates.name !== undefined && typeof updates.name === 'string') {
      record.name = updates.name.trim();
    }

    if (updates.amount !== undefined) {
      const amount = Number(updates.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('סכום לא תקין');
      }
      record.amount = amount;
    }

    if (updates.vat !== undefined) {
      const vat = Number(updates.vat);
      if (!Number.isFinite(vat) || vat < 0) {
        throw new Error('מע"מ לא תקין');
      }
      record.vat = vat;
    }

    if (updates.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(updates.date)) {
        throw new Error('תאריך לא תקין');
      }
      record.date = updates.date;
    }

    // Update other fields as needed
    if (updates.category !== undefined) record.category = updates.category;
    if (updates.clientId !== undefined) record.clientId = updates.clientId;
    if (updates.supplierId !== undefined) record.supplierId = updates.supplierId;
    if (updates.account !== undefined) record.account = updates.account;
    if (updates.paymentMethod !== undefined) record.paymentMethod = updates.paymentMethod;
    if (updates.notes !== undefined) record.notes = updates.notes;

    record.updatedAt = new Date().toISOString();

    await this.save(data);
    return record;
  }

  async deleteRecord(recordId) {
    const data = await this.load();
    const initialLength = data.records.length;
    data.records = data.records.filter(r => r.id !== recordId);

    if (data.records.length === initialLength) {
      throw new Error('הרשומה לא נמצאה');
    }

    await this.save(data);
    return true;
  }
}

// Helper functions
function validateCredentials(username, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
    throw new Error('שם משתמש לא תקין (3–64 תווים: אותיות, ספרות, נקודה, קו תחתון או מקף)');
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 256) {
    throw new Error('הסיסמה חייבת להכיל לפחות 12 תווים');
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  const [, salt, expected] = String(storedHash).split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function isValidData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.version !== undefined && (!Number.isInteger(Number(value.version)) || Number(value.version) < 1 || Number(value.version) > 4)) return false;

  for (const collection of collections) {
    if (objectCollections.has(collection)) {
      // Object collection
      if (value[collection] === undefined || typeof value[collection] !== 'object' || Array.isArray(value[collection])) {
        return false;
      }
      const defaultObj = defaults[collection];
      for (const key in defaultObj) {
        if (!Array.isArray(defaultObj[key])) continue; // scalar fields (userId, planName, currency) are not lists
        if (value[collection][key] === undefined || !Array.isArray(value[collection][key])) {
          return false;
        }
        for (const item of value[collection][key]) {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) {
            return false;
          }
        }
      }
    } else {
      // Array collection
      if (!Array.isArray(value[collection])) {
        return false;
      }
      for (const item of value[collection]) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          return false;
        }
      }
    }
  }

  // Validate records specifically (if we have records)
  if (value.records) {
    return value.records.every(record => {
      const amount = Number(record.amount);
      const vat = record.vat ? Number(record.vat) : 0;
      return Number.isFinite(amount) && amount >= 0 &&
             Number.isFinite(vat) && vat >= 0 &&
             typeof record.name === 'string' && record.name.trim().length > 0 &&
             typeof record.date === 'string' && record.date.length > 0;
    });
  }

  return true;
}

// המספר הגבוה ביותר שכבר הוקצה: הגדול מבין המונה השמור והמספרים שברשומות
const seqInt = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
const maxNumber = (list, pick) => (Array.isArray(list) ? list : []).reduce((m, x) => {
  const n = x && typeof x === 'object' ? Number(pick(x)) : NaN;
  return Number.isSafeInteger(n) && n > m ? n : m;
}, 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// שחזור: כל מונה = הגדול מבין הגיבוי למה שכבר הוקצה במסד הנוכחי. משנה את next במקום.
// חשבוניות (settings.invoiceSeq), מסמכי מכירה לפי סוג (settings.docSeq), קבלות עמותה (npo.settings.receiptSeq),
// אסמכתאות מס"ב (npo/gemach.masav.refSeq), דרישות תשלום (payments.settings.nextNumber — המספר הבא), תיקי שומה (realEstate.seq)
function keepCounters(next, current) {
  const cs = obj(current.settings);
  next.settings = { ...obj(next.settings) };
  const inv = Math.max(seqInt(cs.invoiceSeq), maxNumber(current.invoices, i => i.number));
  if (inv > seqInt(next.settings.invoiceSeq)) next.settings.invoiceSeq = inv;

  const curDoc = obj(cs.docSeq);
  const docs = Array.isArray(current.salesDocs) ? current.salesDocs : [];
  const kinds = new Set([...Object.keys(curDoc), ...docs.map(d => d && d.kind)].filter(k => typeof k === 'string' && /^[a-z][a-z-]*$/.test(k)));
  const docSeq = { ...obj(next.settings.docSeq) };
  let docChanged = false;
  for (const k of kinds) {
    const v = Math.max(seqInt(curDoc[k]), maxNumber(docs.filter(d => d && d.kind === k), d => d.number));
    if (v > seqInt(docSeq[k])) { docSeq[k] = v; docChanged = true; }
  }
  if (docChanged) next.settings.docSeq = docSeq;

  const curNpo = obj(current.npo);
  next.npo = { ...obj(next.npo) };
  const receipts = Math.max(seqInt(obj(curNpo.settings).receiptSeq), maxNumber(curNpo.donations, d => (d.receipt && !d.receipt.external ? d.receipt.number : null)));
  if (receipts > seqInt(obj(next.npo.settings).receiptSeq)) next.npo.settings = { ...obj(next.npo.settings), receiptSeq: receipts };

  for (const [domain, list] of [['npo', 'standingOrders'], ['gemach', 'loans']]) {
    const cur = obj(current[domain]);
    const ref = Math.max(seqInt(obj(cur.masav).refSeq), maxNumber(cur[list], x => x.masavRef));
    next[domain] = { ...obj(next[domain]) };
    if (ref > seqInt(obj(next[domain].masav).refSeq)) next[domain].masav = { ...obj(next[domain].masav), refSeq: ref };
  }

  const curPay = obj(current.payments);
  const nextReq = Math.max(seqInt(obj(curPay.settings).nextNumber), maxNumber(curPay.requests, r => r.number) + 1);
  next.payments = { ...obj(next.payments) };
  if (nextReq > seqInt(obj(next.payments.settings).nextNumber)) next.payments.settings = { ...obj(next.payments.settings), nextNumber: nextReq };

  const curRe = obj(current.realEstate);
  const cases = Math.max(seqInt(curRe.seq), maxNumber(curRe.cases, c => c.no));
  next.realEstate = { ...obj(next.realEstate) };
  if (cases > seqInt(next.realEstate.seq)) next.realEstate.seq = cases;
  return next;
}

function normalizeData(value) {
  const result = {
    ...defaults,
    ...value,
    version: 4
  };

  for (const key of collections) {
    if (objectCollections.has(key)) {
      // Object collections: ensure they are objects with proper structure
      const defaultObj = defaults[key];
      const val = value[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        result[key] = { ...defaultObj, ...val };
      } else {
        result[key] = { ...defaultObj };
      }
    } else {
      // Array collections: ensure they are arrays
      result[key] = Array.isArray(value[key]) ? value[key] : [];
    }
  }

  return result;
}

// Factory function
// מסד מוצפן שאין לו מפתח: מועבר הצידה (לא נמחק) עם קבצי ה-WAL, כדי לפתוח מסד ריק ולשחזר מגיבוי.
// אם הקוד יימצא אחר כך — מחזירים את הקובץ לשמו ונכנסים עם הקוד
function setAsideLockedDatabase(userDataPath, now = Date.now()) {
  const base = path.join(userDataPath, 'unified_economics.db');
  const target = `${base}.locked-${now}`;
  fs.renameSync(base, target);
  for (const ext of ['-wal', '-shm']) { if (fs.existsSync(base + ext)) fs.renameSync(base + ext, target + ext); }
  return target;
}

async function initializeDatabase(userDataPath, options = {}) {
  const dbPath = path.join(userDataPath, 'unified_economics.db');
  const database = new Database(dbPath, options);
  await database.initialize();
  return database;
}

module.exports = { initializeDatabase, setAsideLockedDatabase, isValidData, keepCounters, defaults, ROLES };
