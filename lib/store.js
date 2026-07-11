const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.QMREADER_DATA_DIR
  ? path.resolve(process.env.QMREADER_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = process.env.QMREADER_DB_FILE
  ? path.resolve(process.env.QMREADER_DB_FILE)
  : path.join(DATA_DIR, 'qmreader.sqlite');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT,
    author TEXT,
    published TEXT,
    published_ts INTEGER DEFAULT 0,
    summary TEXT,
    content TEXT,
    image TEXT,
    audio_json TEXT,
    content_hash TEXT,
    original_fetched_at INTEGER,
    original_fetch_attempted_at INTEGER,
    original_fetch_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_source_published
    ON entries(source_id, published_ts DESC);

  CREATE TABLE IF NOT EXISTS entry_translations (
    entry_id TEXT PRIMARY KEY,
    user_id TEXT,
    title_zh TEXT,
    summary_zh TEXT,
    content_json TEXT,
    model TEXT,
    provider TEXT DEFAULT 'deepseek',
    created_by TEXT,
    content_hash TEXT,
    title_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS entry_rewrites (
    entry_id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT,
    body TEXT NOT NULL,
    model TEXT,
    provider TEXT DEFAULT 'deepseek',
    created_by TEXT,
    content_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS entry_ai_asset_contributions (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    user_id TEXT,
    author TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    content_json TEXT,
    body TEXT,
    model TEXT,
    provider TEXT DEFAULT 'deepseek',
    content_hash TEXT,
    title_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK(asset_type IN ('translation', 'rewrite')),
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_asset_contributions_user
    ON entry_ai_asset_contributions(entry_id, asset_type, user_id);

  CREATE INDEX IF NOT EXISTS idx_ai_asset_contributions_user_type
    ON entry_ai_asset_contributions(user_id, asset_type, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_ai_asset_contributions_entry
    ON entry_ai_asset_contributions(entry_id, asset_type, updated_at DESC);

  CREATE TABLE IF NOT EXISTS commentaries (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    user_id TEXT,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    model TEXT,
    is_public INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_commentaries_entry
    ON commentaries(entry_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    user_id TEXT,
    role TEXT NOT NULL,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    is_public INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chat_messages_entry
    ON chat_messages(entry_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT,
    avatar_url TEXT,
    links_json TEXT,
    default_reader_tab TEXT NOT NULL DEFAULT 'rewrite',
    role TEXT NOT NULL DEFAULT 'user',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);

  CREATE TABLE IF NOT EXISTS user_follows (
    follower_id TEXT NOT NULL,
    following_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(follower_id, following_id),
    CHECK(follower_id <> following_id),
    FOREIGN KEY(follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(following_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_follows_following
    ON user_follows(following_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    actor_id TEXT,
    type TEXT NOT NULL,
    object_type TEXT,
    object_id TEXT,
    entry_id TEXT,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications(user_id, is_read, created_at DESC);

  CREATE TABLE IF NOT EXISTS comment_reactions (
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reaction TEXT NOT NULL DEFAULT 'helpful',
    created_at INTEGER NOT NULL,
    PRIMARY KEY(comment_id, user_id, reaction),
    FOREIGN KEY(comment_id) REFERENCES commentaries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment
    ON comment_reactions(comment_id, reaction);

  CREATE TABLE IF NOT EXISTS text_annotations (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    surface TEXT NOT NULL,
    asset_id TEXT NOT NULL DEFAULT '',
    user_id TEXT,
    author TEXT NOT NULL,
    quote TEXT NOT NULL,
    prefix TEXT,
    suffix TEXT,
    body TEXT NOT NULL,
    content_hash TEXT,
    is_public INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK(surface IN ('original', 'rewrite', 'translation')),
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_text_annotations_entry
    ON text_annotations(entry_id, surface, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_text_annotations_user
    ON text_annotations(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS text_annotation_replies (
    id TEXT PRIMARY KEY,
    annotation_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    user_id TEXT,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(annotation_id) REFERENCES text_annotations(id) ON DELETE CASCADE,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_text_annotation_replies_annotation
    ON text_annotation_replies(annotation_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS text_annotation_reactions (
    annotation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reaction TEXT NOT NULL DEFAULT 'helpful',
    created_at INTEGER NOT NULL,
    PRIMARY KEY(annotation_id, user_id, reaction),
    FOREIGN KEY(annotation_id) REFERENCES text_annotations(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_text_annotation_reactions_annotation
    ON text_annotation_reactions(annotation_id, reaction);

  CREATE TABLE IF NOT EXISTS chat_reactions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reaction TEXT NOT NULL DEFAULT 'helpful',
    created_at INTEGER NOT NULL,
    PRIMARY KEY(message_id, user_id, reaction),
    FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chat_reactions_message
    ON chat_reactions(message_id, reaction);

  CREATE TABLE IF NOT EXISTS entry_asset_reactions (
    entry_id TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    asset_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    reaction TEXT NOT NULL DEFAULT 'helpful',
    created_at INTEGER NOT NULL,
    PRIMARY KEY(entry_id, asset_type, asset_id, user_id, reaction),
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_entry_asset_reactions_asset
    ON entry_asset_reactions(entry_id, asset_type, asset_id, reaction);

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON sessions(user_id, expires_at DESC);

  CREATE TABLE IF NOT EXISTS user_entry_states (
    user_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    read_at INTEGER,
    starred_at INTEGER,
    viewed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, entry_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS entry_stats (
    entry_id TEXT PRIMARY KEY,
    view_count INTEGER NOT NULL DEFAULT 0,
    last_viewed_at INTEGER,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS entry_reactions (
    entry_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reaction TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(entry_id, user_id),
    CHECK(reaction IN ('like', 'dislike')),
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_entry_reactions_entry
    ON entry_reactions(entry_id, reaction);

  CREATE TABLE IF NOT EXISTS user_submissions (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    user_id TEXT,
    author TEXT NOT NULL,
    note TEXT,
    submission_count INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_user_submissions_updated
    ON user_submissions(updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_user_submissions_user
    ON user_submissions(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS submission_requests (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    user_id TEXT NOT NULL,
    author TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    reviewed_by TEXT,
    review_reason TEXT,
    entry_id TEXT,
    UNIQUE(user_id, url),
    CHECK(status IN ('pending', 'approved', 'rejected')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_submission_requests_status
    ON submission_requests(status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_submission_requests_user
    ON submission_requests(user_id, status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_user_entry_states_starred
    ON user_entry_states(user_id, starred_at DESC);

  CREATE INDEX IF NOT EXISTS idx_user_entry_states_read
    ON user_entry_states(user_id, read_at DESC);

  CREATE TABLE IF NOT EXISTS refresh_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  );
`);

function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
  if (exists) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (error) {
    if (!/duplicate column name/i.test(String(error && error.message))) throw error;
  }
}

ensureColumn('commentaries', 'user_id', 'user_id TEXT');
ensureColumn('chat_messages', 'user_id', 'user_id TEXT');
ensureColumn('entry_translations', 'user_id', 'user_id TEXT');
ensureColumn('entry_rewrites', 'user_id', 'user_id TEXT');
ensureColumn('user_entry_states', 'viewed_at', 'viewed_at INTEGER');
ensureColumn('entries', 'original_fetched_at', 'original_fetched_at INTEGER');
ensureColumn('entries', 'original_fetch_attempted_at', 'original_fetch_attempted_at INTEGER');
ensureColumn('entries', 'original_fetch_error', 'original_fetch_error TEXT');
ensureColumn('entries', 'deleted_at', 'deleted_at INTEGER');
ensureColumn('entries', 'deleted_by', 'deleted_by TEXT');
ensureColumn('entries', 'deleted_reason', 'deleted_reason TEXT');
ensureColumn('users', 'bio', 'bio TEXT');
ensureColumn('users', 'avatar_url', 'avatar_url TEXT');
ensureColumn('users', 'links_json', 'links_json TEXT');
ensureColumn('users', 'default_reader_tab', "default_reader_tab TEXT NOT NULL DEFAULT 'rewrite'");
ensureColumn('users', 'disabled_at', 'disabled_at INTEGER');
ensureColumn('users', 'disabled_by', 'disabled_by TEXT');
ensureColumn('users', 'disabled_reason', 'disabled_reason TEXT');
ensureEntryAssetReactionsSchema();
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_user_entry_states_viewed
    ON user_entry_states(user_id, viewed_at DESC);

  CREATE INDEX IF NOT EXISTS idx_entries_deleted
    ON entries(deleted_at);
`);

function ensureEntryAssetReactionsSchema() {
  const columns = db.prepare('PRAGMA table_info(entry_asset_reactions)').all();
  const assetIdColumn = columns.find(row => row.name === 'asset_id');
  if (assetIdColumn && Number(assetIdColumn.pk) > 0) return;
  const assetIdExpr = assetIdColumn ? "COALESCE(asset_id, '')" : "''";
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      ALTER TABLE entry_asset_reactions RENAME TO entry_asset_reactions_old;
      CREATE TABLE entry_asset_reactions (
        entry_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        asset_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL,
        reaction TEXT NOT NULL DEFAULT 'helpful',
        created_at INTEGER NOT NULL,
        PRIMARY KEY(entry_id, asset_type, asset_id, user_id, reaction),
        FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO entry_asset_reactions (entry_id, asset_type, asset_id, user_id, reaction, created_at)
      SELECT entry_id, asset_type, ${assetIdExpr}, user_id, reaction, created_at
      FROM entry_asset_reactions_old;
      DROP TABLE entry_asset_reactions_old;
      CREATE INDEX IF NOT EXISTS idx_entry_asset_reactions_asset
        ON entry_asset_reactions(entry_id, asset_type, asset_id, reaction);
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

const upsertEntryStmt = db.prepare(`
  INSERT INTO entries (
    id, source_id, title, link, author, published, published_ts, summary,
    content, image, audio_json, content_hash, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    source_id = excluded.source_id,
    title = excluded.title,
    link = excluded.link,
    author = excluded.author,
    published = excluded.published,
    published_ts = excluded.published_ts,
    summary = excluded.summary,
    content = excluded.content,
    image = excluded.image,
    audio_json = excluded.audio_json,
    content_hash = excluded.content_hash,
    updated_at = excluded.updated_at
`);
const existingEntryForUpsertStmt = db.prepare('SELECT content, summary, image FROM entries WHERE id = ?');

function plainTextLength(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeJsonParse(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function assetSnippet(value, max = 180) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function translationSnippet(content) {
  const pairs = Array.isArray(content) ? content : [];
  const hit = pairs.find(pair => pair && (pair.target || pair.targetHtml));
  return hit ? assetSnippet(hit.target || hit.targetHtml) : '';
}

function now() {
  return Date.now();
}

const SESSION_CLEANUP_INTERVAL_MS = 1000 * 60 * 60;
let lastSessionCleanupAt = 0;

function publicAuthor(author) {
  const clean = String(author || '').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 40) || '读者';
}

function normalizeProfileLinks(value) {
  const raw = Array.isArray(value) ? value : safeJsonParse(value, []);
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .map(item => {
      const url = String(item && item.url || '').trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) return null;
      seen.add(url);
      const title = String(item && item.title || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      return { title: title || url.replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, 48), url };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function cleanBio(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function cleanAvatarUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 1000);
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw) && raw.length <= 450000) return raw;
  const err = new Error('头像格式不支持');
  err.statusCode = 400;
  throw err;
}

function getUserSocialStats(userId, viewerId = '') {
  const id = String(userId || '').trim();
  if (!id) return { followerCount: 0, followingCount: 0, followedByMe: false };
  const followers = db.prepare('SELECT COUNT(*) AS count FROM user_follows WHERE following_id = ?').get(id);
  const following = db.prepare('SELECT COUNT(*) AS count FROM user_follows WHERE follower_id = ?').get(id);
  const followedByMe = viewerId && viewerId !== id
    ? Boolean(db.prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?').get(viewerId, id))
    : false;
  return {
    followerCount: Number(followers && followers.count) || 0,
    followingCount: Number(following && following.count) || 0,
    followedByMe,
  };
}

function unreadNotificationCount(userId) {
  const id = String(userId || '').trim();
  if (!id) return 0;
  const row = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0').get(id);
  return Number(row && row.count) || 0;
}

function normalizeAiAssetType(type) {
  const clean = String(type || '').trim().toLowerCase();
  return clean === 'translation' || clean === 'rewrite' ? clean : '';
}

function normalizeAnnotationSurface(surface) {
  const clean = String(surface || '').trim().toLowerCase();
  return ['original', 'rewrite', 'translation'].includes(clean) ? clean : 'original';
}

function saveAiAssetContribution(entryId, type, asset, timestamp = now()) {
  const assetType = normalizeAiAssetType(type);
  const userId = String(asset && asset.userId || '').trim();
  const id = normalizeEntryId(entryId);
  if (!id || !assetType || !userId) return null;
  const title = assetType === 'translation' ? asset.titleZh || '' : asset.title || '';
  const summary = assetType === 'translation' ? asset.summaryZh || '' : '';
  const contentJson = assetType === 'translation' ? JSON.stringify(asset.content || []) : null;
  const body = assetType === 'rewrite' ? asset.body || '' : null;
  if (assetType === 'translation' && (!contentJson || contentJson === '[]')) return null;
  if (assetType === 'rewrite' && !String(body || '').trim()) return null;

  db.prepare(`
    INSERT INTO entry_ai_asset_contributions (
      id, entry_id, asset_type, user_id, author, title, summary, content_json, body,
      model, provider, content_hash, title_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id, asset_type, user_id) DO UPDATE SET
      author = excluded.author,
      title = excluded.title,
      summary = excluded.summary,
      content_json = excluded.content_json,
      body = excluded.body,
      model = excluded.model,
      provider = excluded.provider,
      content_hash = excluded.content_hash,
      title_hash = excluded.title_hash,
      updated_at = excluded.updated_at
  `).run(
    crypto.randomUUID(),
    id,
    assetType,
    userId,
    publicAuthor(asset.createdBy || asset.author || '读者'),
    title,
    summary,
    contentJson,
    body,
    asset.model || '',
    asset.provider || 'deepseek',
    asset.contentHash || '',
    asset.titleHash || '',
    timestamp,
    timestamp,
  );
  const row = db.prepare(`
    SELECT id
    FROM entry_ai_asset_contributions
    WHERE entry_id = ? AND asset_type = ? AND user_id = ?
  `).get(id, assetType, userId);
  return row && row.id ? row.id : null;
}

function backfillAiAssetContributions() {
  const insert = db.prepare(`
    INSERT INTO entry_ai_asset_contributions (
      id, entry_id, asset_type, user_id, author, title, summary, content_json, body,
      model, provider, content_hash, title_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id, asset_type, user_id) DO NOTHING
  `);
  const translations = db.prepare(`
    SELECT entry_id, user_id, title_zh, summary_zh, content_json, model, provider,
           created_by, content_hash, title_hash, created_at, updated_at
    FROM entry_translations
    WHERE user_id IS NOT NULL
      AND content_json IS NOT NULL
      AND content_json <> ''
      AND content_json <> '[]'
  `).all();
  const rewrites = db.prepare(`
    SELECT entry_id, user_id, title, body, model, provider, created_by, content_hash, created_at, updated_at
    FROM entry_rewrites
    WHERE user_id IS NOT NULL
      AND body IS NOT NULL
      AND body <> ''
  `).all();
  db.exec('BEGIN');
  try {
    for (const row of translations) {
      insert.run(
        crypto.randomUUID(),
        row.entry_id,
        'translation',
        row.user_id,
        publicAuthor(row.created_by || '读者'),
        row.title_zh || '',
        row.summary_zh || '',
        row.content_json || '[]',
        null,
        row.model || '',
        row.provider || 'deepseek',
        row.content_hash || '',
        row.title_hash || '',
        row.created_at || now(),
        row.updated_at || row.created_at || now(),
      );
    }
    for (const row of rewrites) {
      insert.run(
        crypto.randomUUID(),
        row.entry_id,
        'rewrite',
        row.user_id,
        publicAuthor(row.created_by || '读者'),
        row.title || '',
        '',
        null,
        row.body || '',
        row.model || '',
        row.provider || 'deepseek',
        row.content_hash || '',
        '',
        row.created_at || now(),
        row.updated_at || row.created_at || now(),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

backfillAiAssetContributions();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function assertPassword(password) {
  const value = String(password || '');
  if (value.length < 8 || value.length > 128) {
    const err = new Error('密码长度需要在 8 到 128 个字符之间');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: passwordHash(password, salt) };
}

function verifyPassword(password, salt, hash) {
  const actual = Buffer.from(passwordHash(password, salt), 'hex');
  const expected = Buffer.from(hash || '', 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeDefaultReaderTab(tab) {
  return String(tab || '').trim() === 'original' ? 'original' : 'rewrite';
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    bio: row.bio || '',
    avatarUrl: row.avatar_url || '',
    links: normalizeProfileLinks(row.links_json),
    defaultReaderTab: normalizeDefaultReaderTab(row.default_reader_tab),
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at || null,
    ...getUserSocialStats(row.id),
    notificationUnreadCount: unreadNotificationCount(row.id),
  };
}

function publicContributor(row, viewer = null) {
  if (!row) return null;
  const viewerId = viewer && viewer.id ? viewer.id : '';
  return {
    id: row.id,
    displayName: row.display_name,
    bio: row.bio || '',
    avatarUrl: row.avatar_url || '',
    links: normalizeProfileLinks(row.links_json),
    createdAt: row.created_at,
    ...getUserSocialStats(row.id, viewerId),
  };
}

function getContributorHelpfulStats(userId) {
  const id = String(userId || '').trim();
  if (!id) return { helpfulCount: 0, helpfulAssets: 0 };
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(helpful_count), 0) AS helpful_count,
      COUNT(*) AS helpful_assets
    FROM (
      SELECT c.id AS asset_key, COUNT(r.user_id) AS helpful_count
      FROM entry_ai_asset_contributions c
      JOIN entries e ON e.id = c.entry_id
      JOIN entry_asset_reactions r
        ON r.entry_id = c.entry_id
       AND r.asset_type = c.asset_type
       AND r.asset_id = c.id
       AND r.reaction = 'helpful'
      WHERE c.user_id = ?
        AND COALESCE(e.deleted_at, 0) = 0
        AND (
          (c.asset_type = 'translation' AND c.content_json IS NOT NULL AND c.content_json <> '' AND c.content_json <> '[]')
          OR (c.asset_type = 'rewrite' AND c.body IS NOT NULL AND c.body <> '')
        )
      GROUP BY c.id
      HAVING COUNT(r.user_id) > 0

      UNION ALL

      SELECT c.id AS asset_key, COUNT(r.user_id) AS helpful_count
      FROM commentaries c
      JOIN entries e ON e.id = c.entry_id
      JOIN comment_reactions r
        ON r.comment_id = c.id
       AND r.reaction = 'helpful'
      WHERE c.user_id = ?
        AND c.is_public = 1
        AND COALESCE(e.deleted_at, 0) = 0
      GROUP BY c.id
      HAVING COUNT(r.user_id) > 0

      UNION ALL

      SELECT a.id AS asset_key, COUNT(r.user_id) AS helpful_count
      FROM text_annotations a
      JOIN entries e ON e.id = a.entry_id
      JOIN text_annotation_reactions r
        ON r.annotation_id = a.id
       AND r.reaction = 'helpful'
      WHERE a.user_id = ?
        AND a.is_public = 1
        AND COALESCE(e.deleted_at, 0) = 0
      GROUP BY a.id
      HAVING COUNT(r.user_id) > 0

      UNION ALL

      SELECT m.id AS asset_key, COUNT(r.user_id) AS helpful_count
      FROM chat_messages m
      JOIN entries e ON e.id = m.entry_id
      JOIN chat_reactions r
        ON r.message_id = m.id
       AND r.reaction = 'helpful'
      WHERE m.user_id = ?
        AND m.is_public = 1
        AND COALESCE(e.deleted_at, 0) = 0
      GROUP BY m.id
      HAVING COUNT(r.user_id) > 0
    )
  `).get(id, id, id, id);
  return {
    helpfulCount: Number(row && row.helpful_count) || 0,
    helpfulAssets: Number(row && row.helpful_assets) || 0,
  };
}

function getContributor(userId, viewer = null) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const contributor = publicContributor(db.prepare(`
    SELECT id, display_name, bio, avatar_url, links_json, created_at
    FROM users
    WHERE id = ? AND COALESCE(disabled_at, 0) = 0
  `).get(id), viewer);
  return contributor ? { ...contributor, ...getContributorHelpfulStats(id) } : null;
}

function normalizeContributorSort(sort = '') {
  return ['helpful', 'assets'].includes(String(sort || '').trim()) ? String(sort || '').trim() : 'latest';
}

function compareContributors(a, b, sort = 'latest') {
  const nameDelta = String(a.displayName || '').localeCompare(String(b.displayName || ''), 'zh-Hans-CN', { sensitivity: 'base' });
  if (sort === 'helpful') {
    return (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0))
      || (Number(b.helpfulAssets || 0) - Number(a.helpfulAssets || 0))
      || (Number(b.latestAt || 0) - Number(a.latestAt || 0))
      || (Number(b.assetCount || 0) - Number(a.assetCount || 0))
      || nameDelta;
  }
  if (sort === 'assets') {
    return (Number(b.assetCount || 0) - Number(a.assetCount || 0))
      || (Number(b.latestAt || 0) - Number(a.latestAt || 0))
      || (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0))
      || nameDelta;
  }
  return (Number(b.latestAt || 0) - Number(a.latestAt || 0))
    || (Number(b.assetCount || 0) - Number(a.assetCount || 0))
    || nameDelta;
}

function getContributors({ limit = 100, sort = 'latest' } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
  const contributorSort = normalizeContributorSort(sort);
  return db.prepare(`
    SELECT u.id, u.display_name, u.bio, u.avatar_url, u.links_json, u.created_at,
           COALESCE(t.translation_count, 0) AS translation_count,
           COALESCE(t.latest_translation_at, 0) AS latest_translation_at,
           COALESCE(w.rewrite_count, 0) AS rewrite_count,
           COALESCE(w.latest_rewrite_at, 0) AS latest_rewrite_at,
           COALESCE(c.comment_count, 0) AS comment_count,
           COALESCE(c.latest_comment_at, 0) AS latest_comment_at,
           COALESCE(a.annotation_count, 0) AS annotation_count,
           COALESCE(a.latest_annotation_at, 0) AS latest_annotation_at,
           COALESCE(m.chat_count, 0) AS chat_count,
           COALESCE(m.latest_chat_at, 0) AS latest_chat_at
    FROM users u
    LEFT JOIN (
      SELECT user_id,
             COUNT(*) AS translation_count,
             MAX(c.updated_at) AS latest_translation_at
      FROM entry_ai_asset_contributions c
      JOIN entries e ON e.id = c.entry_id
      WHERE asset_type = 'translation'
        AND user_id IS NOT NULL
        AND content_json IS NOT NULL
        AND content_json <> ''
        AND content_json <> '[]'
        AND COALESCE(e.deleted_at, 0) = 0
      GROUP BY user_id
    ) t ON t.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
             COUNT(*) AS rewrite_count,
             MAX(c.updated_at) AS latest_rewrite_at
      FROM entry_ai_asset_contributions c
      JOIN entries e ON e.id = c.entry_id
      WHERE asset_type = 'rewrite'
        AND user_id IS NOT NULL
        AND body IS NOT NULL
        AND body <> ''
        AND COALESCE(e.deleted_at, 0) = 0
      GROUP BY user_id
    ) w ON w.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
             COUNT(*) AS comment_count,
             MAX(COALESCE(c.updated_at, c.created_at)) AS latest_comment_at
      FROM commentaries c
      JOIN entries e ON e.id = c.entry_id
      WHERE is_public = 1 AND user_id IS NOT NULL
        AND COALESCE(e.deleted_at, 0) = 0
      GROUP BY user_id
    ) c ON c.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
             COUNT(*) AS annotation_count,
             MAX(COALESCE(a.updated_at, a.created_at)) AS latest_annotation_at
      FROM text_annotations a
      JOIN entries e ON e.id = a.entry_id
      WHERE is_public = 1 AND user_id IS NOT NULL
        AND COALESCE(e.deleted_at, 0) = 0
      GROUP BY user_id
    ) a ON a.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
             COUNT(*) AS chat_count,
             MAX(m.created_at) AS latest_chat_at
      FROM chat_messages m
      JOIN entries e ON e.id = m.entry_id
      WHERE is_public = 1 AND user_id IS NOT NULL
        AND COALESCE(e.deleted_at, 0) = 0
      GROUP BY user_id
    ) m ON m.user_id = u.id
    WHERE COALESCE(u.disabled_at, 0) = 0
      AND (
        COALESCE(t.translation_count, 0) > 0
        OR COALESCE(w.rewrite_count, 0) > 0
        OR COALESCE(c.comment_count, 0) > 0
        OR COALESCE(a.annotation_count, 0) > 0
        OR COALESCE(m.chat_count, 0) > 0
      )
  `).all().map(row => {
    const translationCount = Number(row.translation_count) || 0;
    const rewriteCount = Number(row.rewrite_count) || 0;
    const commentCount = Number(row.comment_count) || 0;
    const annotationCount = Number(row.annotation_count) || 0;
    const chatCount = Number(row.chat_count) || 0;
    return {
      id: row.id,
      displayName: row.display_name,
      bio: row.bio || '',
      avatarUrl: row.avatar_url || '',
      links: normalizeProfileLinks(row.links_json),
      createdAt: row.created_at,
      translationCount,
      rewriteCount,
      commentCount,
      annotationCount,
      chatCount,
      assetCount: translationCount + rewriteCount + commentCount + annotationCount + chatCount,
      latestAt: Math.max(
        Number(row.latest_translation_at) || 0,
        Number(row.latest_rewrite_at) || 0,
        Number(row.latest_comment_at) || 0,
        Number(row.latest_annotation_at) || 0,
        Number(row.latest_chat_at) || 0,
      ),
      ...getUserSocialStats(row.id),
      ...getContributorHelpfulStats(row.id),
    };
  }).sort((a, b) => compareContributors(a, b, contributorSort)).slice(0, safeLimit);
}

function createUser({ email, password, displayName = '', role = 'user' }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    const err = new Error('请输入有效邮箱');
    err.statusCode = 400;
    throw err;
  }
  const cleanPassword = assertPassword(password);
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) {
    const err = new Error('这个邮箱已经注册');
    err.statusCode = 409;
    throw err;
  }
  const id = crypto.randomUUID();
  const t = now();
  const record = createPasswordRecord(cleanPassword);
  db.prepare(`
    INSERT INTO users (id, email, display_name, role, password_hash, password_salt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalizedEmail,
    publicAuthor(displayName || normalizedEmail.split('@')[0]),
    role === 'admin' ? 'admin' : 'user',
    record.hash,
    record.salt,
    t,
    t,
  );
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function ensureAdminUser({ email, password, displayName = '向阳乔木' }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) return null;
  if (!isValidEmail(normalizedEmail)) throw new Error('ADMIN_EMAIL is invalid');
  const cleanPassword = assertPassword(password);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  const record = createPasswordRecord(cleanPassword);
  const t = now();
  if (row) {
    db.prepare(`
      UPDATE users
      SET display_name = ?, role = 'admin', password_hash = ?, password_salt = ?,
          disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL, updated_at = ?
      WHERE email = ?
    `).run(publicAuthor(displayName), record.hash, record.salt, t, normalizedEmail);
  } else {
    db.prepare(`
      INSERT INTO users (id, email, display_name, role, password_hash, password_salt, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, ?, ?, ?)
    `).run(crypto.randomUUID(), normalizedEmail, publicAuthor(displayName), record.hash, record.salt, t, t);
  }
  return publicUser(db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail));
}

function authenticateUser(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!row || !verifyPassword(String(password || ''), row.password_salt, row.password_hash)) {
    const err = new Error('邮箱或密码不正确');
    err.statusCode = 401;
    throw err;
  }
  if (Number(row.disabled_at)) {
    const err = new Error('账号已被管理员停用');
    err.statusCode = 403;
    throw err;
  }
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), row.id);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id));
}

function updateUserProfile(userId, { displayName, bio, avatarUrl, links, defaultReaderTab } = {}) {
  const id = String(userId || '').trim();
  const row = id ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
  if (!row) {
    const err = new Error('user not found');
    err.statusCode = 404;
    throw err;
  }
  const nextName = publicAuthor(displayName || row.display_name);
  const nextBio = cleanBio(bio);
  const nextAvatar = cleanAvatarUrl(avatarUrl);
  const nextLinks = normalizeProfileLinks(links);
  const hasDefaultReaderTab = defaultReaderTab !== undefined;
  const nextDefaultReaderTab = hasDefaultReaderTab
    ? normalizeDefaultReaderTab(defaultReaderTab)
    : normalizeDefaultReaderTab(row.default_reader_tab);
  const t = now();
  db.prepare(`
    UPDATE users
    SET display_name = ?,
        bio = ?,
        avatar_url = ?,
        links_json = ?,
        default_reader_tab = ?,
        updated_at = ?
    WHERE id = ?
  `).run(nextName, nextBio, nextAvatar, JSON.stringify(nextLinks), nextDefaultReaderTab, t, id);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function updateUserPassword(userId, { currentPassword, newPassword } = {}) {
  const id = String(userId || '').trim();
  const row = id ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
  if (!row) {
    const err = new Error('user not found');
    err.statusCode = 404;
    throw err;
  }
  if (!verifyPassword(String(currentPassword || ''), row.password_salt, row.password_hash)) {
    const err = new Error('当前密码不正确');
    err.statusCode = 401;
    throw err;
  }
  const cleanPassword = assertPassword(newPassword);
  if (verifyPassword(cleanPassword, row.password_salt, row.password_hash)) {
    const err = new Error('新密码不能和当前密码相同');
    err.statusCode = 400;
    throw err;
  }
  const record = createPasswordRecord(cleanPassword);
  const t = now();
  db.prepare(`
    UPDATE users
    SET password_hash = ?,
        password_salt = ?,
        updated_at = ?
    WHERE id = ?
  `).run(record.hash, record.salt, t, id);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function createNotification({ userId, actorId = null, type, objectType = '', objectId = '', entryId = '', message = '' } = {}) {
  const targetId = String(userId || '').trim();
  const actor = String(actorId || '').trim() || null;
  if (!targetId || !type || (actor && actor === targetId)) return null;
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!exists) return null;
  const id = crypto.randomUUID();
  const t = now();
  db.prepare(`
    INSERT INTO notifications (id, user_id, actor_id, type, object_type, object_id, entry_id, message, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    targetId,
    actor,
    String(type || '').slice(0, 48),
    String(objectType || '').slice(0, 48),
    String(objectId || '').slice(0, 120),
    normalizeEntryId(entryId) || null,
    String(message || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    t,
  );
  return id;
}

function setUserFollow(followerId, followingId, follow = true) {
  const follower = String(followerId || '').trim();
  const following = String(followingId || '').trim();
  if (!follower || !following) {
    const err = new Error('user id is required');
    err.statusCode = 400;
    throw err;
  }
  if (follower === following) {
    const err = new Error('不能关注自己');
    err.statusCode = 400;
    throw err;
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(following);
  if (!target) {
    const err = new Error('user not found');
    err.statusCode = 404;
    throw err;
  }
  const t = now();
  if (follow) {
    const result = db.prepare(`
      INSERT OR IGNORE INTO user_follows (follower_id, following_id, created_at)
      VALUES (?, ?, ?)
    `).run(follower, following, t);
    if (result.changes) {
      const actor = db.prepare('SELECT display_name FROM users WHERE id = ?').get(follower);
      createNotification({
        userId: following,
        actorId: follower,
        type: 'follow',
        objectType: 'user',
        objectId: follower,
        message: `${publicAuthor(actor && actor.display_name || '读者')} 关注了你`,
      });
    }
  } else {
    db.prepare('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?').run(follower, following);
  }
  return getContributor(following, { id: follower });
}

function getUserNotifications(userId, { limit = 80 } = {}) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 80));
  return db.prepare(`
    SELECT n.*, a.display_name AS actor_name, a.avatar_url AS actor_avatar,
           e.title AS entry_title, tr.title_zh AS entry_title_zh,
           tr.title_hash AS translation_title_hash
    FROM notifications n
    LEFT JOIN users a ON a.id = n.actor_id
    LEFT JOIN entries e ON e.id = n.entry_id
    LEFT JOIN entry_translations tr ON tr.entry_id = e.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT ?
  `).all(id, safeLimit).map(row => {
    const translatedTitle = validTranslatedTitle(row, 'entry_title', 'entry_title_zh');
    const message = !translatedTitle && row.entry_title_zh
      ? String(row.message || '').split(row.entry_title_zh).join(row.entry_title || '文章')
      : row.message;
    return {
      id: row.id,
      type: row.type,
      objectType: row.object_type || '',
      objectId: row.object_id || '',
      entryId: row.entry_id || '',
      entryTitle: translatedTitle || row.entry_title || '',
      actorId: row.actor_id || '',
      actorName: row.actor_name || '',
      actorAvatarUrl: row.actor_avatar || '',
      message,
      read: Boolean(row.is_read),
      createdAt: row.created_at,
    };
  });
}

function markNotificationsRead(userId) {
  const id = String(userId || '').trim();
  if (!id) return 0;
  const result = db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(id);
  return Number(result.changes) || 0;
}

function cleanupExpiredSessions({ force = false } = {}) {
  const t = now();
  if (!force && t - lastSessionCleanupAt < SESSION_CLEANUP_INTERVAL_MS) return 0;
  lastSessionCleanupAt = t;
  const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
  return Number(result.changes) || 0;
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createSession(userId, ttlMs = 1000 * 60 * 60 * 24 * 30) {
  cleanupExpiredSessions({ force: true });
  const user = db.prepare('SELECT id, disabled_at FROM users WHERE id = ?').get(String(userId || '').trim());
  if (!user || Number(user.disabled_at)) {
    const err = new Error(user ? '账号已被管理员停用' : 'user not found');
    err.statusCode = user ? 403 : 404;
    throw err;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  const expiresAt = t + ttlMs;
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashSessionToken(token), userId, expiresAt, t);
  return { token, expiresAt };
}

function getUserBySessionToken(token) {
  if (!token) return null;
  return publicUser(db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND COALESCE(u.disabled_at, 0) = 0
  `).get(hashSessionToken(token), now()));
}

function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token));
}

function normalizeEntryId(entryId) {
  return String(entryId || '').trim().slice(0, 80);
}

function normalizeAiAssetId(assetId) {
  return String(assetId || '').trim().slice(0, 80);
}

const ENTRY_ASSET_REACTION_TYPES = new Set(['translation', 'rewrite']);

function normalizeAssetReactionType(type) {
  const clean = String(type || '').trim().toLowerCase();
  return ENTRY_ASSET_REACTION_TYPES.has(clean) ? clean : '';
}

function hasEntryAsset(entryId, type, assetId = '') {
  const id = normalizeEntryId(entryId);
  const assetType = normalizeAssetReactionType(type);
  const aiAssetId = normalizeAiAssetId(assetId);
  if (!id || !assetType) return false;
  if (aiAssetId) {
    const row = db.prepare(`
      SELECT id
      FROM entry_ai_asset_contributions
      WHERE id = ?
        AND entry_id = ?
        AND asset_type = ?
        AND (
          (asset_type = 'translation' AND content_json IS NOT NULL AND content_json <> '' AND content_json <> '[]')
          OR (asset_type = 'rewrite' AND body IS NOT NULL AND body <> '')
        )
    `).get(aiAssetId, id, assetType);
    return Boolean(row);
  }
  if (assetType === 'translation') {
    const row = db.prepare(`
      SELECT content_json
      FROM entry_translations
      WHERE entry_id = ? AND content_json IS NOT NULL AND content_json <> '' AND content_json <> '[]'
    `).get(id);
    const content = safeJsonParse(row && row.content_json, []);
    return Array.isArray(content) && content.some(pair => pair && String(pair.target || pair.targetHtml || '').trim());
  }
  if (assetType === 'rewrite') {
    return Boolean(db.prepare(`
      SELECT entry_id
      FROM entry_rewrites
      WHERE entry_id = ? AND body IS NOT NULL AND body <> ''
    `).get(id));
  }
  return false;
}

function getUserEntryStates(userId) {
  const rows = db.prepare(`
    SELECT entry_id, read_at, starred_at, viewed_at
    FROM user_entry_states
    WHERE user_id = ? AND (read_at IS NOT NULL OR starred_at IS NOT NULL OR viewed_at IS NOT NULL)
  `).all(userId);
  return {
    read: rows.filter(row => row.read_at).map(row => row.entry_id),
    starred: rows.filter(row => row.starred_at).map(row => row.entry_id),
    history: rows
      .filter(row => row.viewed_at)
      .sort((a, b) => Number(b.viewed_at || 0) - Number(a.viewed_at || 0))
      .map(row => ({ entryId: row.entry_id, viewedAt: row.viewed_at })),
  };
}

function getUserEntryState(userId, entryId) {
  const row = db.prepare(`
    SELECT entry_id, read_at, starred_at, viewed_at
    FROM user_entry_states
    WHERE user_id = ? AND entry_id = ?
  `).get(userId, normalizeEntryId(entryId));
  return {
    entryId: normalizeEntryId(entryId),
    read: Boolean(row && row.read_at),
    starred: Boolean(row && row.starred_at),
    viewed: Boolean(row && row.viewed_at),
    readAt: row && row.read_at ? row.read_at : null,
    starredAt: row && row.starred_at ? row.starred_at : null,
    viewedAt: row && row.viewed_at ? row.viewed_at : null,
  };
}

function setUserEntryState(userId, entryId, { read, starred, viewed } = {}) {
  const id = normalizeEntryId(entryId);
  if (!userId || !id) {
    const err = new Error('entryId is required');
    err.statusCode = 400;
    throw err;
  }

  const existing = db.prepare(`
    SELECT read_at, starred_at, viewed_at
    FROM user_entry_states
    WHERE user_id = ? AND entry_id = ?
  `).get(userId, id);
  const t = now();
  const readAt = read === true ? (existing && existing.read_at) || t : read === false ? null : existing && existing.read_at;
  const starredAt = starred === true ? (existing && existing.starred_at) || t : starred === false ? null : existing && existing.starred_at;
  const viewedAt = viewed === true ? t : viewed === false ? null : existing && existing.viewed_at;

  if (!readAt && !starredAt && !viewedAt) {
    db.prepare('DELETE FROM user_entry_states WHERE user_id = ? AND entry_id = ?').run(userId, id);
  } else {
    db.prepare(`
      INSERT INTO user_entry_states (user_id, entry_id, read_at, starred_at, viewed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, entry_id) DO UPDATE SET
        read_at = excluded.read_at,
        starred_at = excluded.starred_at,
        viewed_at = excluded.viewed_at,
        updated_at = excluded.updated_at
    `).run(userId, id, readAt || null, starredAt || null, viewedAt || null, t);
  }
  return getUserEntryState(userId, id);
}

function markEntriesRead(userId, entryIds) {
  const ids = [...new Set((entryIds || []).map(normalizeEntryId).filter(Boolean))].slice(0, 1000);
  const stmt = db.prepare(`
    INSERT INTO user_entry_states (user_id, entry_id, read_at, starred_at, viewed_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL, ?)
    ON CONFLICT(user_id, entry_id) DO UPDATE SET
      read_at = COALESCE(user_entry_states.read_at, excluded.read_at),
      updated_at = excluded.updated_at
  `);
  const t = now();
  db.exec('BEGIN');
  try {
    for (const id of ids) stmt.run(userId, id, t, t);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getUserEntryStates(userId);
}

function emptyEntryStats(entryId, reactionByMe = '') {
  return {
    entryId,
    viewCount: 0,
    favoriteCount: 0,
    likeCount: 0,
    dislikeCount: 0,
    reactionByMe,
    lastViewedAt: null,
    updatedAt: null,
  };
}

function getEntryStats(entryIds, viewer = null) {
  const ids = [...new Set((entryIds || []).map(normalizeEntryId).filter(Boolean))];
  const out = {};
  for (const id of ids) out[id] = emptyEntryStats(id);
  if (!ids.length) return out;

  const placeholders = ids.map(() => '?').join(',');
  for (const row of db.prepare(`
    SELECT entry_id, view_count, last_viewed_at, updated_at
    FROM entry_stats
    WHERE entry_id IN (${placeholders})
  `).all(...ids)) {
    const stats = out[row.entry_id];
    if (row) {
      stats.viewCount = Number(row.view_count) || 0;
      stats.lastViewedAt = row.last_viewed_at || null;
      stats.updatedAt = row.updated_at || null;
    }
  }

  for (const row of db.prepare(`
    SELECT entry_id, COUNT(*) AS count
    FROM user_entry_states
    WHERE entry_id IN (${placeholders}) AND starred_at IS NOT NULL
    GROUP BY entry_id
  `).all(...ids)) {
    if (out[row.entry_id]) out[row.entry_id].favoriteCount = Number(row.count) || 0;
  }

  for (const row of db.prepare(`
    SELECT entry_id, reaction, COUNT(*) AS count
    FROM entry_reactions
    WHERE entry_id IN (${placeholders})
    GROUP BY entry_id, reaction
  `).all(...ids)) {
    const stats = out[row.entry_id];
    if (!stats) continue;
    if (row.reaction === 'like') stats.likeCount = Number(row.count) || 0;
    if (row.reaction === 'dislike') stats.dislikeCount = Number(row.count) || 0;
  }

  if (viewer && viewer.id) {
    for (const row of db.prepare(`
      SELECT entry_id, reaction
      FROM entry_reactions
      WHERE entry_id IN (${placeholders}) AND user_id = ?
    `).all(...ids, viewer.id)) {
      if (out[row.entry_id]) out[row.entry_id].reactionByMe = row.reaction || '';
    }
  }
  return out;
}

function recordEntryView(entryId) {
  const id = normalizeEntryId(entryId);
  if (!id) {
    const err = new Error('entryId is required');
    err.statusCode = 400;
    throw err;
  }
  const t = now();
  db.prepare(`
    INSERT INTO entry_stats (entry_id, view_count, last_viewed_at, updated_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      view_count = entry_stats.view_count + 1,
      last_viewed_at = excluded.last_viewed_at,
      updated_at = excluded.updated_at
  `).run(id, t, t);
  return getEntryStats([id])[id];
}

function setEntryReaction(entryId, userId, reaction) {
  const id = normalizeEntryId(entryId);
  const cleanReaction = String(reaction || '').trim().toLowerCase();
  if (!id || !userId) {
    const err = new Error('entryId is required');
    err.statusCode = 400;
    throw err;
  }
  if (cleanReaction && cleanReaction !== 'like' && cleanReaction !== 'dislike') {
    const err = new Error('reaction must be like or dislike');
    err.statusCode = 400;
    throw err;
  }
  const t = now();
  if (!cleanReaction) {
    db.prepare('DELETE FROM entry_reactions WHERE entry_id = ? AND user_id = ?').run(id, userId);
  } else {
    db.prepare(`
      INSERT INTO entry_reactions (entry_id, user_id, reaction, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(entry_id, user_id) DO UPDATE SET
        reaction = excluded.reaction,
        updated_at = excluded.updated_at
    `).run(id, userId, cleanReaction, t, t);
  }
  return getEntryStats([id], { id: userId })[id];
}

function validTranslatedTitle(row, titleKey = 'title', translatedKey = 'title_zh', hashKey = 'translation_title_hash') {
  const translated = String(row && row[translatedKey] || '').trim();
  if (!translated) return null;
  const savedHash = String(row && row[hashKey] || '').trim();
  if (savedHash !== hashText(row && row[titleKey] || '')) return null;
  return translated;
}

function normalizeEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    title: row.title,
    titleZh: validTranslatedTitle(row),
    link: row.link || '',
    author: row.author || '',
    published: row.published || null,
    publishedTs: row.published_ts || 0,
    summary: row.summary || '',
    summaryZh: row.summary_zh || null,
    content: row.content || '',
    image: row.image || null,
    audio: safeJsonParse(row.audio_json, null),
    contentHash: row.content_hash || null,
    originalFetchedAt: row.original_fetched_at || null,
    originalFetchAttemptedAt: row.original_fetch_attempted_at || null,
    originalFetchError: row.original_fetch_error || '',
    deletedAt: row.deleted_at || null,
    deletedBy: row.deleted_by || '',
    deletedReason: row.deleted_reason || '',
  };
}

function upsertEntries(entries) {
  db.exec('BEGIN');
  try {
    const t = now();
    for (const entry of entries || []) {
      const existing = existingEntryForUpsertStmt.get(entry.id);
      const incomingContent = entry.content || '';
      const existingContent = existing && existing.content ? existing.content : '';
      const content = existingContent && plainTextLength(existingContent) > plainTextLength(incomingContent) + 240
        ? existingContent
        : incomingContent;
      const summary = entry.summary || (existing && existing.summary) || '';
      const image = entry.image || (existing && existing.image) || null;
      upsertEntryStmt.run(
        entry.id,
        entry.sourceId,
        entry.title || '(无标题)',
        entry.link || '',
        entry.author || '',
        entry.published || null,
        entry.publishedTs || 0,
        summary,
        content,
        image,
        entry.audio ? JSON.stringify(entry.audio) : null,
        hashText((entry.title || '') + '\n' + (content || summary || '')),
        t,
        t,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getEntry(id) {
  return normalizeEntry(db.prepare(`
    SELECT e.*, t.title_zh, t.summary_zh, t.title_hash AS translation_title_hash
    FROM entries e
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    WHERE e.id = ? AND COALESCE(e.deleted_at, 0) = 0
  `).get(id));
}

function getEntryByIdPrefix(prefix) {
  const clean = normalizeEntryId(prefix);
  if (clean.length < 6) return null;
  const rows = db.prepare(`
    SELECT e.*, t.title_zh, t.summary_zh, t.title_hash AS translation_title_hash
    FROM entries e
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    WHERE e.id LIKE ? AND COALESCE(e.deleted_at, 0) = 0
    ORDER BY LENGTH(e.id) ASC, e.published_ts DESC
    LIMIT 2
  `).all(`${clean}%`);
  if (rows.length !== 1) return null;
  return normalizeEntry(rows[0]);
}

function isEntryDeleted(entryId) {
  const id = normalizeEntryId(entryId);
  if (!id) return false;
  const row = db.prepare('SELECT deleted_at FROM entries WHERE id = ?').get(id);
  return Boolean(row && Number(row.deleted_at));
}

function softDeleteEntry(entryId, { userId = '', reason = '' } = {}) {
  const id = normalizeEntryId(entryId);
  if (!id) {
    const err = new Error('entryId is required');
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare('SELECT id, deleted_at FROM entries WHERE id = ?').get(id);
  if (!existing) return null;
  if (Number(existing.deleted_at)) return { id, alreadyDeleted: true };
  const t = now();
  db.prepare(`
    UPDATE entries
    SET deleted_at = ?,
        deleted_by = ?,
        deleted_reason = ?,
        updated_at = ?
    WHERE id = ?
  `).run(t, String(userId || '').trim() || null, String(reason || '').trim().slice(0, 300) || null, t, id);
  return { id, deletedAt: t, alreadyDeleted: false };
}

function updateEntryContent(entryId, { content = '', summary = '', image = null, originalFetched = false } = {}) {
  const id = normalizeEntryId(entryId);
  const entry = getEntry(id);
  if (!entry) return null;
  const nextContent = String(content || '').trim();
  if (!nextContent) return entry;
  const nextSummary = String(summary || '').trim().slice(0, 320) || entry.summary || '';
  const nextImage = image || entry.image || null;
  const t = now();
  db.prepare(`
    UPDATE entries
    SET content = ?,
        summary = ?,
        image = ?,
        content_hash = ?,
        original_fetched_at = ?,
        original_fetch_attempted_at = ?,
        original_fetch_error = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    nextContent,
    nextSummary,
    nextImage,
    hashText((entry.title || '') + '\n' + (nextContent || nextSummary || '')),
    originalFetched ? t : entry.originalFetchedAt || null,
    originalFetched ? t : entry.originalFetchAttemptedAt || null,
    originalFetched ? null : entry.originalFetchError || null,
    t,
    id,
  );
  return getEntry(id);
}

function markEntryOriginalFetchAttempt(entryId, error = '') {
  const id = normalizeEntryId(entryId);
  if (!id) return null;
  const t = now();
  db.prepare(`
    UPDATE entries
    SET original_fetch_attempted_at = ?,
        original_fetch_error = ?,
        updated_at = ?
    WHERE id = ?
  `).run(t, String(error || '').slice(0, 500) || null, t, id);
  return getEntry(id);
}

function normalizeSubmissionRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    userId: row.user_id,
    author: row.author || '',
    note: row.note || '',
    status: row.status,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    reviewedAt: Number(row.reviewed_at) || null,
    reviewedBy: row.reviewed_by || '',
    reviewReason: row.review_reason || '',
    entryId: row.entry_id || '',
    email: row.email || '',
    displayName: row.display_name || '',
  };
}

function getSubmissionRequest(id) {
  return normalizeSubmissionRequest(db.prepare(`
    SELECT r.*, u.email, u.display_name
    FROM submission_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(String(id || '').trim()));
}

function getSubmissionRequests({ status = 'pending', limit = 200 } = {}) {
  const cleanStatus = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
  const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 200));
  return db.prepare(`
    SELECT r.*, u.email, u.display_name
    FROM submission_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.status = ? AND COALESCE(u.disabled_at, 0) = 0
    ORDER BY r.created_at ASC
    LIMIT ?
  `).all(cleanStatus, safeLimit).map(normalizeSubmissionRequest);
}

function createSubmissionRequest({ url = '', userId = '', author = '', note = '' } = {}) {
  const cleanUrl = String(url || '').trim();
  const cleanUserId = String(userId || '').trim();
  const user = cleanUserId ? db.prepare('SELECT id, email, display_name, disabled_at FROM users WHERE id = ?').get(cleanUserId) : null;
  if (!cleanUrl || !user || Number(user.disabled_at)) {
    const err = new Error('有效登录账号和链接是必需的');
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare('SELECT id FROM submission_requests WHERE user_id = ? AND url = ?').get(cleanUserId, cleanUrl);
  if (existing) return getSubmissionRequest(existing.id);
  const totalPending = Number(db.prepare("SELECT COUNT(*) AS count FROM submission_requests WHERE status = 'pending'").get().count) || 0;
  if (totalPending >= 500) {
    const err = new Error('待审核队列已满，请稍后再提交');
    err.statusCode = 503;
    throw err;
  }
  const pending = Number(db.prepare("SELECT COUNT(*) AS count FROM submission_requests WHERE user_id = ? AND status = 'pending'").get(cleanUserId).count) || 0;
  if (pending >= 3) {
    const err = new Error('你已有 3 条待审核投稿，请等待管理员处理');
    err.statusCode = 429;
    throw err;
  }
  const t = now();
  const id = hashText(`submission-request:${cleanUserId}:${cleanUrl}`).slice(0, 32);
  db.prepare(`
    INSERT INTO submission_requests (id, url, user_id, author, note, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, cleanUrl, cleanUserId, publicAuthor(author || user.display_name || user.email), String(note || '').trim().slice(0, 500), t, t);
  return getSubmissionRequest(id);
}

function reviewSubmissionRequest(id, { status = '', reviewedBy = '', reason = '', entryId = '' } = {}) {
  const request = getSubmissionRequest(id);
  if (!request) {
    const err = new Error('submission request not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['approved', 'rejected'].includes(status)) {
    const err = new Error('审核状态无效');
    err.statusCode = 400;
    throw err;
  }
  if (request.status !== 'pending') return request;
  const t = now();
  db.prepare(`
    UPDATE submission_requests
    SET status = ?, reviewed_at = ?, reviewed_by = ?, review_reason = ?, entry_id = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(status, t, String(reviewedBy || '').trim() || null, String(reason || '').trim().slice(0, 300) || null, String(entryId || '').trim() || null, t, request.id);
  return getSubmissionRequest(request.id);
}

function saveSubmittedEntry(entry, { userId = null, author = '读者', note = '' } = {}) {
  if (!entry || !entry.id || !entry.link) {
    const err = new Error('entry is required');
    err.statusCode = 400;
    throw err;
  }
  upsertEntries([entry]);
  if (isEntryDeleted(entry.id)) {
    const err = new Error('这个链接已被管理员移除，暂不能重新收录');
    err.statusCode = 403;
    throw err;
  }
  const t = now();
  const submissionId = hashText(`submission:${entry.link}`).slice(0, 32);
  db.prepare(`
    INSERT INTO user_submissions (id, entry_id, url, user_id, author, note, submission_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      entry_id = excluded.entry_id,
      user_id = COALESCE(user_submissions.user_id, excluded.user_id),
      author = COALESCE(NULLIF(user_submissions.author, ''), excluded.author),
      note = CASE WHEN excluded.note IS NOT NULL AND excluded.note <> '' THEN excluded.note ELSE user_submissions.note END,
      submission_count = user_submissions.submission_count + 1,
      updated_at = excluded.updated_at
  `).run(
    submissionId,
    entry.id,
    entry.link,
    userId || null,
    publicAuthor(author || '读者'),
    String(note || '').trim().slice(0, 500),
    t,
    t,
  );
  return getEntry(entry.id);
}

function getSubmittedEntries({ limit = 200 } = {}) {
  const n = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 200));
  return db.prepare(`
    SELECT e.*, t.title_zh, t.summary_zh, t.title_hash AS translation_title_hash
    FROM user_submissions s
    JOIN entries e ON e.id = s.entry_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    WHERE COALESCE(e.deleted_at, 0) = 0
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(n).map(normalizeEntry);
}

function getSubmissionMeta() {
  const row = db.prepare(`
    SELECT COUNT(*) AS count, MAX(s.updated_at) AS latest_at
    FROM user_submissions s
    JOIN entries e ON e.id = s.entry_id
    WHERE COALESCE(e.deleted_at, 0) = 0
  `).get();
  return {
    count: Number(row && row.count) || 0,
    latestAt: Number(row && row.latest_at) || null,
  };
}

function adminSubmissionUser(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: Number(row.user_created_at) || 0,
    activeSubmissionCount: Number(row.active_submission_count) || 0,
    deletedSubmissionCount: Number(row.deleted_submission_count) || 0,
    totalSubmissionCount: Number(row.total_submission_count) || 0,
    latestSubmittedAt: Number(row.latest_submitted_at) || 0,
    disabled: Boolean(Number(row.disabled_at) || 0),
    disabledAt: Number(row.disabled_at) || null,
    disabledBy: row.disabled_by || '',
    disabledReason: row.disabled_reason || '',
  };
}

function getAdminSubmissionUsers({ q = '', limit = 200 } = {}) {
  const cleanQuery = String(q || '').trim().slice(0, 100);
  const likeQuery = `%${cleanQuery}%`;
  const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 200));
  return db.prepare(`
    SELECT u.id AS user_id, u.email, u.display_name, u.role, u.created_at AS user_created_at,
           u.disabled_at, u.disabled_by, u.disabled_reason,
           COUNT(s.id) AS total_submission_count,
           SUM(CASE WHEN COALESCE(e.deleted_at, 0) = 0 THEN 1 ELSE 0 END) AS active_submission_count,
           SUM(CASE WHEN COALESCE(e.deleted_at, 0) <> 0 THEN 1 ELSE 0 END) AS deleted_submission_count,
           MAX(MAX(s.updated_at, e.published_ts)) AS latest_submitted_at
    FROM user_submissions s
    JOIN users u ON u.id = s.user_id
    JOIN entries e ON e.id = s.entry_id AND e.source_id = 'user-submitted'
    WHERE (? = '' OR u.display_name LIKE ? OR SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) LIKE ?)
    GROUP BY u.id, u.email, u.display_name, u.role, u.created_at
    ORDER BY active_submission_count DESC, latest_submitted_at DESC, u.display_name ASC
    LIMIT ?
  `).all(cleanQuery, likeQuery, likeQuery, safeLimit).map(adminSubmissionUser);
}

function getAdminUserSubmissions(userId, { limit = 500 } = {}) {
  const id = String(userId || '').trim();
  const userRow = id ? db.prepare(`
    SELECT id AS user_id, email, display_name, role, created_at AS user_created_at,
           disabled_at, disabled_by, disabled_reason
    FROM users
    WHERE id = ?
  `).get(id) : null;
  if (!userRow) {
    const err = new Error('user not found');
    err.statusCode = 404;
    throw err;
  }
  const counts = db.prepare(`
    SELECT COUNT(s.id) AS total_submission_count,
           SUM(CASE WHEN COALESCE(e.deleted_at, 0) = 0 THEN 1 ELSE 0 END) AS active_submission_count,
           SUM(CASE WHEN COALESCE(e.deleted_at, 0) <> 0 THEN 1 ELSE 0 END) AS deleted_submission_count,
           MAX(s.updated_at) AS latest_submitted_at
    FROM user_submissions s
    JOIN entries e ON e.id = s.entry_id AND e.source_id = 'user-submitted'
    WHERE s.user_id = ?
  `).get(id) || {};
  const safeLimit = Math.max(1, Math.min(1000, Number.parseInt(limit, 10) || 500));
  const submissions = db.prepare(`
    SELECT s.id AS submission_id, s.entry_id, s.url, s.author, s.note, s.submission_count,
           s.created_at, MAX(s.updated_at, e.published_ts) AS visible_at,
           e.title, e.link, e.deleted_at, e.deleted_by, e.deleted_reason
    FROM user_submissions s
    JOIN entries e ON e.id = s.entry_id AND e.source_id = 'user-submitted'
    WHERE s.user_id = ?
    ORDER BY COALESCE(e.deleted_at, 0) = 0 DESC, MAX(s.updated_at, e.published_ts) DESC
    LIMIT ?
  `).all(id, safeLimit).map(row => ({
    submissionId: row.submission_id,
    entryId: row.entry_id,
    title: row.title,
    url: row.url || row.link || '',
    author: row.author || '',
    note: row.note || '',
    submissionCount: Number(row.submission_count) || 1,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.visible_at) || 0,
    deletedAt: Number(row.deleted_at) || null,
    deletedBy: row.deleted_by || '',
    deletedReason: row.deleted_reason || '',
  }));
  const user = adminSubmissionUser({ ...userRow, ...counts });
  return {
    user,
    activeSubmissionCount: user.activeSubmissionCount,
    deletedSubmissionCount: user.deletedSubmissionCount,
    totalSubmissionCount: user.totalSubmissionCount,
    latestSubmittedAt: user.latestSubmittedAt,
    submissions,
  };
}

function getAdminUsers({ q = '', limit = 500 } = {}) {
  const cleanQuery = String(q || '').trim().slice(0, 100);
  const likeQuery = `%${cleanQuery}%`;
  const safeLimit = Math.max(1, Math.min(1000, Number.parseInt(limit, 10) || 500));
  return db.prepare(`
    SELECT u.id AS user_id, u.email, u.display_name, u.role, u.created_at AS user_created_at,
           u.disabled_at, u.disabled_by, u.disabled_reason,
           COALESCE(s.total_submission_count, 0) AS total_submission_count,
           COALESCE(s.active_submission_count, 0) AS active_submission_count,
           COALESCE(s.deleted_submission_count, 0) AS deleted_submission_count,
           COALESCE(s.latest_submitted_at, 0) AS latest_submitted_at
    FROM users u
    LEFT JOIN (
      SELECT us.user_id,
             COUNT(us.id) AS total_submission_count,
             SUM(CASE WHEN COALESCE(e.deleted_at, 0) = 0 THEN 1 ELSE 0 END) AS active_submission_count,
             SUM(CASE WHEN COALESCE(e.deleted_at, 0) <> 0 THEN 1 ELSE 0 END) AS deleted_submission_count,
             MAX(MAX(us.updated_at, e.published_ts)) AS latest_submitted_at
      FROM user_submissions us
      JOIN entries e ON e.id = us.entry_id AND e.source_id = 'user-submitted'
      WHERE us.user_id IS NOT NULL
      GROUP BY us.user_id
    ) s ON s.user_id = u.id
    WHERE (? = '' OR u.display_name LIKE ? OR SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) LIKE ?)
    ORDER BY COALESCE(u.disabled_at, 0) DESC, active_submission_count DESC,
             latest_submitted_at DESC, u.created_at DESC
    LIMIT ?
  `).all(cleanQuery, likeQuery, likeQuery, safeLimit).map(adminSubmissionUser);
}

function softDeleteUserSubmissions(userId, { deletedBy = '', reason = '' } = {}) {
  const preview = getAdminUserSubmissions(userId, { limit: 1000 });
  const entryIds = preview.submissions
    .filter(item => !item.deletedAt)
    .map(item => item.entryId);
  if (!entryIds.length) {
    return { user: preview.user, deletedCount: 0, entryIds: [] };
  }
  const t = now();
  const cleanReason = String(reason || '').trim().slice(0, 300) || '管理员批量删除用户投稿';
  const result = db.prepare(`
    UPDATE entries
    SET deleted_at = ?, deleted_by = ?, deleted_reason = ?, updated_at = ?
    WHERE source_id = 'user-submitted'
      AND COALESCE(deleted_at, 0) = 0
      AND id IN (
        SELECT entry_id
        FROM user_submissions
        WHERE user_id = ?
      )
  `).run(t, String(deletedBy || '').trim() || null, cleanReason, t, preview.user.userId);
  return {
    user: preview.user,
    deletedCount: Number(result.changes) || 0,
    entryIds,
    deletedAt: t,
  };
}

function disableUserForModeration(userId, { adminUserId = '', reason = '' } = {}) {
  const targetId = String(userId || '').trim();
  const moderatorId = String(adminUserId || '').trim();
  const target = targetId ? db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId) : null;
  if (!target) {
    const err = new Error('user not found');
    err.statusCode = 404;
    throw err;
  }
  if (target.role === 'admin' || targetId === moderatorId) {
    const err = new Error('不能删除管理员账号');
    err.statusCode = 403;
    throw err;
  }
  const cleanReason = String(reason || '').trim().slice(0, 300) || '发布违规内容';
  const t = now();
  let deletedSubmissionCount = 0;
  let revokedSessionCount = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    deletedSubmissionCount = Number(db.prepare(`
      UPDATE entries
      SET deleted_at = ?, deleted_by = ?, deleted_reason = ?, updated_at = ?
      WHERE source_id = 'user-submitted'
        AND COALESCE(deleted_at, 0) = 0
        AND id IN (SELECT entry_id FROM user_submissions WHERE user_id = ?)
    `).run(t, moderatorId || null, `违规用户清理：${cleanReason}`.slice(0, 300), t, targetId).changes) || 0;
    db.prepare(`
      UPDATE users
      SET disabled_at = COALESCE(disabled_at, ?), disabled_by = ?, disabled_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(t, moderatorId || null, cleanReason, t, targetId);
    db.prepare(`
      UPDATE submission_requests
      SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, review_reason = ?, updated_at = ?
      WHERE user_id = ? AND status = 'pending'
    `).run(t, moderatorId || null, `账号封禁：${cleanReason}`.slice(0, 300), t, targetId);
    revokedSessionCount = Number(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId).changes) || 0;
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const user = getAdminUsers({ limit: 1000 }).find(item => item.userId === targetId);
  return { user, deletedSubmissionCount, revokedSessionCount };
}

function restoreModeratedUser(userId, { adminUserId = '' } = {}) {
  const targetId = String(userId || '').trim();
  const target = targetId ? db.prepare('SELECT id FROM users WHERE id = ?').get(targetId) : null;
  if (!target) {
    const err = new Error('user not found');
    err.statusCode = 404;
    throw err;
  }
  db.prepare(`
    UPDATE users
    SET disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL, updated_at = ?
    WHERE id = ?
  `).run(now(), targetId);
  return getAdminUsers({ limit: 1000 }).find(item => item.userId === targetId);
}

function getTitleTranslations(ids) {
  const cleanIds = [...new Set((ids || []).map(normalizeEntryId).filter(Boolean))];
  if (!cleanIds.length) return {};
  const out = {};
  for (let offset = 0; offset < cleanIds.length; offset += 400) {
    const chunk = cleanIds.slice(offset, offset + 400);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT t.entry_id, t.title_zh, t.title_hash, e.title
      FROM entry_translations t
      JOIN entries e ON e.id = t.entry_id
      WHERE t.entry_id IN (${placeholders})
        AND t.title_zh IS NOT NULL
        AND t.title_zh <> ''
    `).all(...chunk);
    for (const row of rows) {
      if (row.title_hash !== hashText(row.title || '')) continue;
      out[row.entry_id] = row.title_zh;
    }
  }
  return out;
}

function getEntryAssetSummaries(ids) {
  const cleanIds = [...new Set((ids || []).map(normalizeEntryId).filter(Boolean))];
  const out = {};
  for (const id of cleanIds) {
    out[id] = {
      translation: false,
      rewrite: false,
      comments: 0,
      annotations: 0,
      chatMessages: 0,
      latestAt: 0,
      latestTypes: [],
      preview: null,
      previews: {},
      items: {},
      translationCount: 0,
      rewriteCount: 0,
      helpfulCount: 0,
      commentHelpfulCount: 0,
      annotationHelpfulCount: 0,
      chatHelpfulCount: 0,
      translationHelpfulCount: 0,
      rewriteHelpfulCount: 0,
      helpfulComments: 0,
      helpfulAnnotations: 0,
      helpfulChats: 0,
      helpfulAssets: 0,
      topHelpfulComment: null,
      topHelpfulAnnotation: null,
      topHelpfulChat: null,
      topHelpfulTranslation: null,
      topHelpfulRewrite: null,
      topHelpfulAsset: null,
    };
  }
  if (!cleanIds.length) return out;
  const placeholders = cleanIds.map(() => '?').join(',');

  function markAsset(entryId, type, timestamp) {
    const asset = out[entryId];
    if (!asset) return;
    const t = Number(timestamp) || 0;
    if (t > asset.latestAt) {
      asset.latestAt = t;
      asset.latestTypes = [type];
      return;
    }
    if (t && t === asset.latestAt && !asset.latestTypes.includes(type)) {
      asset.latestTypes.push(type);
    }
  }

  function setPreview(entryId, type, timestamp, data = {}) {
    const asset = out[entryId];
    if (!asset) return;
    const text = assetSnippet(data.text);
    if (!text) return;
    const preview = {
      type,
      id: data.id || '',
      role: data.role || '',
      author: data.author || '',
      title: data.title || '',
      model: data.model || '',
      text,
      at: Number(timestamp) || 0,
      helpfulCount: Number(data.helpfulCount) || 0,
    };
    const existing = asset.previews[type];
    if (!existing || preview.at >= Number(existing.at || 0)) {
      asset.previews[type] = preview;
    }
    if (!asset.preview || preview.at >= Number(asset.preview.at || 0)) {
      asset.preview = preview;
    }
  }

  function addItemPreview(entryId, type, timestamp, data = {}) {
    const asset = out[entryId];
    if (!asset) return;
    const text = assetSnippet(data.text);
    if (!text) return;
    if (!asset.items[type]) asset.items[type] = [];
    if (asset.items[type].length >= 3) return;
    asset.items[type].push({
      type,
      id: data.id || '',
      role: data.role || '',
      author: data.author || '',
      title: data.title || '',
      model: data.model || '',
      text,
      at: Number(timestamp) || 0,
      helpfulCount: Number(data.helpfulCount) || 0,
    });
  }

  function considerHelpfulAsset(entryId, type, timestamp, data = {}) {
    const asset = out[entryId];
    const helpfulCount = Number(data.helpfulCount) || 0;
    if (!asset || helpfulCount <= 0) return;
    const text = assetSnippet(data.text);
    if (!text) return;
    const preview = {
      type,
      id: data.id || '',
      role: data.role || '',
      author: data.author || '',
      title: data.title || '',
      model: data.model || '',
      text,
      at: Number(timestamp) || 0,
      helpfulCount,
    };
    asset.helpfulCount += helpfulCount;
    if (type === 'chat') {
      asset.chatHelpfulCount += helpfulCount;
      asset.helpfulChats += 1;
    } else if (type === 'annotations') {
      asset.annotationHelpfulCount += helpfulCount;
      asset.helpfulAnnotations += 1;
    } else if (type === 'comments') {
      asset.commentHelpfulCount += helpfulCount;
      asset.helpfulComments += 1;
    } else if (type === 'translation') {
      asset.translationHelpfulCount += helpfulCount;
      asset.helpfulAssets += 1;
    } else if (type === 'rewrite') {
      asset.rewriteHelpfulCount += helpfulCount;
      asset.helpfulAssets += 1;
    }
    const specificKey = type === 'chat'
      ? 'topHelpfulChat'
      : type === 'annotations'
        ? 'topHelpfulAnnotation'
      : type === 'translation'
        ? 'topHelpfulTranslation'
        : type === 'rewrite'
          ? 'topHelpfulRewrite'
          : 'topHelpfulComment';
    const current = asset[specificKey];
    if (
      !current
      || helpfulCount > Number(current.helpfulCount || 0)
      || (helpfulCount === Number(current.helpfulCount || 0) && Number(preview.at || 0) > Number(current.at || 0))
    ) {
      asset[specificKey] = preview;
    }
    const top = asset.topHelpfulAsset;
    if (
      !top
      || helpfulCount > Number(top.helpfulCount || 0)
      || (helpfulCount === Number(top.helpfulCount || 0) && Number(preview.at || 0) > Number(top.at || 0))
    ) {
      asset.topHelpfulAsset = preview;
    }
  }

  function considerHelpfulEntryAsset(entryId, type, timestamp, data = {}) {
    considerHelpfulAsset(entryId, type, timestamp, data);
  }

  function considerHelpfulComment(entryId, timestamp, data = {}) {
    considerHelpfulAsset(entryId, 'comments', timestamp, data);
  }

  function considerHelpfulAnnotation(entryId, timestamp, data = {}) {
    considerHelpfulAsset(entryId, 'annotations', timestamp, data);
  }

  function considerHelpfulChat(entryId, timestamp, data = {}) {
    considerHelpfulAsset(entryId, 'chat', timestamp, data);
  }

  for (const row of db.prepare(`
    SELECT c.entry_id, c.id, c.asset_type, c.author, c.title, c.summary, c.content_json,
           c.body, c.model, c.title_hash, c.created_at, c.updated_at,
           e.title AS entry_title, u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM entry_ai_asset_contributions c
    JOIN entries e ON e.id = c.entry_id
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN (
      SELECT entry_id, asset_type, asset_id, COUNT(*) AS helpful_count
      FROM entry_asset_reactions
      WHERE reaction = 'helpful'
        AND asset_id <> ''
      GROUP BY entry_id, asset_type, asset_id
    ) r ON r.entry_id = c.entry_id AND r.asset_type = c.asset_type AND r.asset_id = c.id
    WHERE c.entry_id IN (${placeholders})
      AND (
        (c.asset_type = 'translation' AND c.content_json IS NOT NULL AND c.content_json <> '' AND c.content_json <> '[]')
        OR (c.asset_type = 'rewrite' AND c.body IS NOT NULL AND c.body <> '')
      )
    ORDER BY c.entry_id, c.asset_type, c.updated_at DESC, c.created_at DESC
  `).all(...cleanIds)) {
    const asset = out[row.entry_id];
    const preview = aiAssetContributionPreview(row, row.helpful_count);
    if (!asset || !preview) continue;
    if (preview.type === 'translation') {
      asset.translation = true;
      asset.translationCount += 1;
    } else if (preview.type === 'rewrite') {
      asset.rewrite = true;
      asset.rewriteCount += 1;
    }
    markAsset(row.entry_id, preview.type, preview.at);
    setPreview(row.entry_id, preview.type, preview.at, preview);
    addItemPreview(row.entry_id, preview.type, preview.at, preview);
    considerHelpfulEntryAsset(row.entry_id, preview.type, preview.at, preview);
  }

  for (const row of db.prepare(`
    SELECT entry_id, content_json, model, created_by, updated_at
    FROM entry_translations
    WHERE entry_id IN (${placeholders})
  `).all(...cleanIds)) {
    const content = safeJsonParse(row.content_json, []);
    const asset = out[row.entry_id];
    if (asset && Array.isArray(content) && content.length > 0 && !asset.translationCount) {
      asset.translation = true;
      asset.translationCount = 1;
      markAsset(row.entry_id, 'translation', row.updated_at);
      setPreview(row.entry_id, 'translation', row.updated_at, {
        author: row.created_by || '',
        model: row.model || '',
        text: translationSnippet(content),
      });
    }
  }

  for (const row of db.prepare(`
    SELECT entry_id, body, model, created_by, updated_at
    FROM entry_rewrites
    WHERE entry_id IN (${placeholders}) AND body IS NOT NULL AND body <> ''
  `).all(...cleanIds)) {
    const asset = out[row.entry_id];
    if (asset && !asset.rewriteCount) {
      asset.rewrite = true;
      asset.rewriteCount = 1;
      markAsset(row.entry_id, 'rewrite', row.updated_at);
      setPreview(row.entry_id, 'rewrite', row.updated_at, {
        author: row.created_by || '',
        model: row.model || '',
        text: row.body || '',
      });
    }
  }

  for (const row of db.prepare(`
    SELECT entry_id, asset_type, COUNT(*) AS helpful_count
    FROM entry_asset_reactions
    WHERE entry_id IN (${placeholders})
      AND reaction = 'helpful'
      AND asset_type IN ('translation', 'rewrite')
      AND asset_id = ''
    GROUP BY entry_id, asset_type
  `).all(...cleanIds)) {
    const asset = out[row.entry_id];
    const type = normalizeAssetReactionType(row.asset_type);
    const preview = asset && type ? asset.previews[type] : null;
    if (!asset || !type || !preview) continue;
    if (Array.isArray(asset.items[type]) && asset.items[type].length) continue;
    const helpfulCount = Number(row.helpful_count) || 0;
    asset.previews[type] = { ...preview, helpfulCount };
    if (asset.preview && asset.preview.type === type) asset.preview = asset.previews[type];
    considerHelpfulEntryAsset(row.entry_id, type, preview.at, {
      ...preview,
      helpfulCount,
    });
  }

  for (const row of db.prepare(`
    SELECT entry_id, COUNT(*) AS count, MAX(updated_at) AS latest_at
    FROM commentaries
    WHERE entry_id IN (${placeholders}) AND is_public = 1
    GROUP BY entry_id
  `).all(...cleanIds)) {
    if (out[row.entry_id]) {
      out[row.entry_id].comments = row.count || 0;
      markAsset(row.entry_id, 'comments', row.latest_at);
    }
  }

  for (const row of db.prepare(`
    SELECT c.entry_id, c.id, c.author, c.body, c.model, c.created_at, c.updated_at,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM commentaries c
    LEFT JOIN (
      SELECT comment_id, COUNT(*) AS helpful_count
      FROM comment_reactions
      WHERE reaction = 'helpful'
      GROUP BY comment_id
    ) r ON r.comment_id = c.id
    JOIN (
      SELECT entry_id, MAX(updated_at) AS latest_at
      FROM commentaries
      WHERE entry_id IN (${placeholders}) AND is_public = 1
      GROUP BY entry_id
    ) latest ON latest.entry_id = c.entry_id AND latest.latest_at = c.updated_at
    WHERE c.is_public = 1
  `).all(...cleanIds)) {
    setPreview(row.entry_id, 'comments', row.updated_at || row.created_at, {
      id: row.id,
      author: row.author,
      model: row.model || '',
      text: row.body,
      helpfulCount: row.helpful_count || 0,
    });
  }

  for (const row of db.prepare(`
    SELECT c.entry_id, c.id, c.author, c.body, c.model, c.created_at, c.updated_at,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM commentaries c
    LEFT JOIN (
      SELECT comment_id, COUNT(*) AS helpful_count
      FROM comment_reactions
      WHERE reaction = 'helpful'
      GROUP BY comment_id
    ) r ON r.comment_id = c.id
    WHERE c.entry_id IN (${placeholders}) AND c.is_public = 1
    ORDER BY c.entry_id, c.updated_at DESC
  `).all(...cleanIds)) {
    considerHelpfulComment(row.entry_id, row.updated_at || row.created_at, {
      id: row.id,
      author: row.author,
      model: row.model || '',
      text: row.body,
      helpfulCount: row.helpful_count || 0,
    });
    addItemPreview(row.entry_id, 'comments', row.updated_at || row.created_at, {
      id: row.id,
      author: row.author,
      model: row.model || '',
      text: row.body,
      helpfulCount: row.helpful_count || 0,
    });
  }

  for (const row of db.prepare(`
    SELECT entry_id, COUNT(*) AS count, MAX(updated_at) AS latest_at
    FROM text_annotations
    WHERE entry_id IN (${placeholders}) AND is_public = 1
    GROUP BY entry_id
  `).all(...cleanIds)) {
    if (out[row.entry_id]) {
      out[row.entry_id].annotations = row.count || 0;
      markAsset(row.entry_id, 'annotations', row.latest_at);
    }
  }

  for (const row of db.prepare(`
    SELECT a.entry_id, a.id, a.author, a.quote, a.body, a.surface, a.created_at, a.updated_at,
           COALESCE(r.helpful_count, 0) AS helpful_count,
           COALESCE(rr.reply_count, 0) AS reply_count
    FROM text_annotations a
    LEFT JOIN (
      SELECT annotation_id, COUNT(*) AS helpful_count
      FROM text_annotation_reactions
      WHERE reaction = 'helpful'
      GROUP BY annotation_id
    ) r ON r.annotation_id = a.id
    LEFT JOIN (
      SELECT annotation_id, COUNT(*) AS reply_count
      FROM text_annotation_replies
      WHERE is_public = 1
      GROUP BY annotation_id
    ) rr ON rr.annotation_id = a.id
    JOIN (
      SELECT entry_id, MAX(updated_at) AS latest_at
      FROM text_annotations
      WHERE entry_id IN (${placeholders}) AND is_public = 1
      GROUP BY entry_id
    ) latest ON latest.entry_id = a.entry_id AND latest.latest_at = a.updated_at
    WHERE a.is_public = 1
  `).all(...cleanIds)) {
    setPreview(row.entry_id, 'annotations', row.updated_at || row.created_at, {
      id: row.id,
      role: row.surface || '',
      author: row.author,
      text: `${row.quote || ''}\n${row.body || ''}`,
      helpfulCount: row.helpful_count || 0,
      replyCount: row.reply_count || 0,
    });
  }

  for (const row of db.prepare(`
    SELECT a.entry_id, a.id, a.author, a.quote, a.body, a.surface, a.created_at, a.updated_at,
           COALESCE(r.helpful_count, 0) AS helpful_count,
           COALESCE(rr.reply_count, 0) AS reply_count
    FROM text_annotations a
    LEFT JOIN (
      SELECT annotation_id, COUNT(*) AS helpful_count
      FROM text_annotation_reactions
      WHERE reaction = 'helpful'
      GROUP BY annotation_id
    ) r ON r.annotation_id = a.id
    LEFT JOIN (
      SELECT annotation_id, COUNT(*) AS reply_count
      FROM text_annotation_replies
      WHERE is_public = 1
      GROUP BY annotation_id
    ) rr ON rr.annotation_id = a.id
    WHERE a.entry_id IN (${placeholders}) AND a.is_public = 1
    ORDER BY a.entry_id, a.updated_at DESC
  `).all(...cleanIds)) {
    const data = {
      id: row.id,
      role: row.surface || '',
      author: row.author,
      text: `${row.quote || ''}\n${row.body || ''}`,
      helpfulCount: row.helpful_count || 0,
      replyCount: row.reply_count || 0,
    };
    considerHelpfulAnnotation(row.entry_id, row.updated_at || row.created_at, data);
    addItemPreview(row.entry_id, 'annotations', row.updated_at || row.created_at, data);
  }

  for (const row of db.prepare(`
    SELECT entry_id, COUNT(*) AS count, MAX(created_at) AS latest_at
    FROM chat_messages
    WHERE entry_id IN (${placeholders}) AND is_public = 1
    GROUP BY entry_id
  `).all(...cleanIds)) {
    if (out[row.entry_id]) {
      out[row.entry_id].chatMessages = row.count || 0;
      markAsset(row.entry_id, 'chat', row.latest_at);
    }
  }

  for (const row of db.prepare(`
    SELECT m.entry_id, m.id, m.role, m.author, m.content, m.model, m.created_at,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM chat_messages m
    LEFT JOIN (
      SELECT message_id, COUNT(*) AS helpful_count
      FROM chat_reactions
      WHERE reaction = 'helpful'
      GROUP BY message_id
    ) r ON r.message_id = m.id
    JOIN (
      SELECT entry_id, MAX(created_at) AS latest_at
      FROM chat_messages
      WHERE entry_id IN (${placeholders}) AND is_public = 1
      GROUP BY entry_id
    ) latest ON latest.entry_id = m.entry_id AND latest.latest_at = m.created_at
    WHERE m.is_public = 1
  `).all(...cleanIds)) {
    setPreview(row.entry_id, 'chat', row.created_at, {
      id: row.id,
      role: row.role,
      author: row.author,
      model: row.model || '',
      text: row.content,
      helpfulCount: row.helpful_count || 0,
    });
  }

  for (const row of db.prepare(`
    SELECT m.entry_id, m.id, m.role, m.author, m.content, m.model, m.created_at,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM chat_messages m
    LEFT JOIN (
      SELECT message_id, COUNT(*) AS helpful_count
      FROM chat_reactions
      WHERE reaction = 'helpful'
      GROUP BY message_id
    ) r ON r.message_id = m.id
    WHERE m.entry_id IN (${placeholders}) AND m.is_public = 1
    ORDER BY m.entry_id, m.created_at DESC
  `).all(...cleanIds)) {
    considerHelpfulChat(row.entry_id, row.created_at, {
      id: row.id,
      role: row.role,
      author: row.author,
      model: row.model || '',
      text: row.content,
      helpfulCount: row.helpful_count || 0,
    });
    addItemPreview(row.entry_id, 'chat', row.created_at, {
      id: row.id,
      role: row.role,
      author: row.author,
      model: row.model || '',
      text: row.content,
      helpfulCount: row.helpful_count || 0,
    });
  }

  return out;
}

function saveTitleTranslations(items, { model = '', provider = 'deepseek', author = 'system' } = {}) {
  const stmt = db.prepare(`
    INSERT INTO entry_translations (
      entry_id, title_zh, model, provider, created_by, title_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      title_zh = excluded.title_zh,
      model = excluded.model,
      provider = excluded.provider,
      created_by = COALESCE(entry_translations.created_by, excluded.created_by),
      title_hash = excluded.title_hash,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    const t = now();
    for (const item of items || []) {
      if (!item || !item.entryId || !item.titleZh) continue;
      stmt.run(item.entryId, item.titleZh, model, provider, publicAuthor(author), item.titleHash || '', t, t);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getTranslation(entryId) {
  const row = db.prepare(`
    SELECT t.*, e.title AS entry_title, u.display_name AS contributor_name, c.id AS asset_id
    FROM entry_translations t
    JOIN entries e ON e.id = t.entry_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN entry_ai_asset_contributions c
      ON c.entry_id = t.entry_id AND c.asset_type = 'translation' AND c.user_id = t.user_id
    WHERE t.entry_id = ?
  `).get(entryId);
  if (!row) return null;
  const content = safeJsonParse(row.content_json, null);
  if (!Array.isArray(content) || !content.some(pair => pair && String(pair.target || pair.targetHtml || '').trim())) {
    return null;
  }
  return {
    id: row.asset_id || '',
    entryId: row.entry_id,
    contributorId: row.user_id || '',
    contributorName: row.contributor_name || '',
    titleZh: validTranslatedTitle(row, 'entry_title', 'title_zh', 'title_hash') || '',
    summaryZh: row.summary_zh || '',
    content,
    model: row.model || '',
    provider: row.provider || 'deepseek',
    createdBy: row.created_by || 'system',
    contentHash: row.content_hash || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function saveTranslation(entryId, translation) {
  const t = now();
  db.prepare(`
    INSERT INTO entry_translations (
      entry_id, user_id, title_zh, summary_zh, content_json, model, provider, created_by,
      content_hash, title_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      user_id = excluded.user_id,
      title_zh = CASE
        WHEN excluded.title_zh <> '' THEN excluded.title_zh
        WHEN entry_translations.title_hash = excluded.title_hash THEN entry_translations.title_zh
        ELSE ''
      END,
      summary_zh = excluded.summary_zh,
      content_json = excluded.content_json,
      model = excluded.model,
      provider = excluded.provider,
      created_by = excluded.created_by,
      content_hash = excluded.content_hash,
      title_hash = excluded.title_hash,
      updated_at = excluded.updated_at
  `).run(
    entryId,
    translation.userId || null,
    translation.titleZh || '',
    translation.summaryZh || '',
    JSON.stringify(translation.content || []),
    translation.model || '',
    translation.provider || 'deepseek',
    publicAuthor(translation.createdBy || 'system'),
    translation.contentHash || '',
    translation.titleHash || '',
    t,
    t,
  );
  const assetId = saveAiAssetContribution(entryId, 'translation', translation, t);
  const saved = getTranslation(entryId);
  return saved && assetId ? { ...saved, id: assetId } : saved;
}

function getRewrite(entryId) {
  const row = db.prepare(`
    SELECT r.*, u.display_name AS contributor_name, c.id AS asset_id
    FROM entry_rewrites r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN entry_ai_asset_contributions c
      ON c.entry_id = r.entry_id AND c.asset_type = 'rewrite' AND c.user_id = r.user_id
    WHERE r.entry_id = ?
  `).get(entryId);
  if (!row) return null;
  return {
    id: row.asset_id || '',
    entryId: row.entry_id,
    contributorId: row.user_id || '',
    contributorName: row.contributor_name || '',
    title: row.title || '',
    body: row.body || '',
    model: row.model || '',
    provider: row.provider || 'deepseek',
    createdBy: row.created_by || 'system',
    contentHash: row.content_hash || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAiAssetContribution(assetId, type = '') {
  const id = String(assetId || '').trim();
  if (!id) return null;
  const assetType = normalizeAiAssetType(type);
  const params = assetType ? [id, assetType] : [id];
  const row = db.prepare(`
    SELECT c.*, e.title AS entry_title, u.display_name AS contributor_name
    FROM entry_ai_asset_contributions c
    JOIN entries e ON e.id = c.entry_id
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
    ${assetType ? 'AND c.asset_type = ?' : ''}
  `).get(...params);
  if (!row) return null;
  const base = {
    id: row.id,
    type: row.asset_type,
    entryId: row.entry_id,
    contributorId: row.user_id || '',
    contributorName: row.contributor_name || row.author || '',
    author: row.author || row.contributor_name || '',
    model: row.model || '',
    provider: row.provider || 'deepseek',
    createdBy: row.author || '读者',
    contentHash: row.content_hash || '',
    titleHash: row.title_hash || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.asset_type === 'translation') {
    return {
      ...base,
      titleZh: validTranslatedTitle(row, 'entry_title', 'title', 'title_hash') || '',
      summaryZh: row.summary || '',
      content: safeJsonParse(row.content_json, []),
    };
  }
  if (row.asset_type === 'rewrite') {
    return {
      ...base,
      title: row.title || '',
      body: row.body || '',
    };
  }
  return base;
}

function aiAssetContributionPreview(row, helpfulCount = 0) {
  const type = normalizeAiAssetType(row && row.asset_type);
  if (!type) return null;
  const at = Number(row.updated_at || row.created_at) || 0;
  const author = row.contributor_name || row.author || '';
  const base = {
    type,
    id: row.id || '',
    author,
    title: type === 'translation'
      ? validTranslatedTitle(row, 'entry_title', 'title', 'title_hash') || ''
      : row.title || '',
    model: row.model || '',
    text: '',
    at,
    helpfulCount: Number(helpfulCount) || 0,
  };
  if (type === 'translation') {
    const content = safeJsonParse(row.content_json, []);
    const text = translationSnippet(content) || assetSnippet(row.summary, 220) || assetSnippet(row.title, 120);
    return text ? { ...base, text } : null;
  }
  if (type === 'rewrite') {
    const text = assetSnippet(row.body, 220) || assetSnippet(row.title, 120);
    return text ? { ...base, text } : null;
  }
  return null;
}

function getEntryAiAssetPreviews(entryId, type = '', { limit = 200 } = {}) {
  const id = normalizeEntryId(entryId);
  const assetType = normalizeAiAssetType(type);
  if (!id || !assetType) return [];
  const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 200));
  return db.prepare(`
    SELECT c.id, c.asset_type, c.author, c.title, c.summary, c.content_json,
           c.body, c.model, c.title_hash, c.created_at, c.updated_at,
           e.title AS entry_title, u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM entry_ai_asset_contributions c
    JOIN entries e ON e.id = c.entry_id
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN (
      SELECT asset_id, COUNT(*) AS helpful_count
      FROM entry_asset_reactions
      WHERE entry_id = ?
        AND asset_type = ?
        AND reaction = 'helpful'
        AND asset_id <> ''
      GROUP BY asset_id
    ) r ON r.asset_id = c.id
    WHERE c.entry_id = ?
      AND c.asset_type = ?
      AND (
        (c.asset_type = 'translation' AND c.content_json IS NOT NULL AND c.content_json <> '' AND c.content_json <> '[]')
        OR (c.asset_type = 'rewrite' AND c.body IS NOT NULL AND c.body <> '')
      )
    ORDER BY c.updated_at DESC, c.created_at DESC
    LIMIT ?
  `).all(id, assetType, id, assetType, safeLimit)
    .map(row => aiAssetContributionPreview(row, row.helpful_count))
    .filter(Boolean);
}

function saveRewrite(entryId, rewrite) {
  const t = now();
  db.prepare(`
    INSERT INTO entry_rewrites (
      entry_id, user_id, title, body, model, provider, created_by, content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      user_id = excluded.user_id,
      title = excluded.title,
      body = excluded.body,
      model = excluded.model,
      provider = excluded.provider,
      created_by = excluded.created_by,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at
  `).run(
    entryId,
    rewrite.userId || null,
    rewrite.title || '',
    rewrite.body || '',
    rewrite.model || '',
    rewrite.provider || 'deepseek',
    publicAuthor(rewrite.createdBy || 'system'),
    rewrite.contentHash || '',
    t,
    t,
  );
  const assetId = saveAiAssetContribution(entryId, 'rewrite', rewrite, t);
  const saved = getRewrite(entryId);
  return saved && assetId ? { ...saved, id: assetId } : saved;
}

function canDeleteAsset(row, viewer = null) {
  if (!row || !viewer) return false;
  if (viewer.role === 'admin') return true;
  return Boolean(row.user_id && viewer.id && row.user_id === viewer.id);
}

function getComments(entryId, viewer = null) {
  const viewerId = viewer && viewer.id ? String(viewer.id) : '';
  return db.prepare(`
    SELECT c.id, c.entry_id, c.user_id, c.author, c.body, c.model, c.created_at, c.updated_at,
           u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count,
           CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END AS helpful_by_me
    FROM commentaries c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN (
      SELECT comment_id, COUNT(*) AS helpful_count
      FROM comment_reactions
      WHERE reaction = 'helpful'
      GROUP BY comment_id
    ) r ON r.comment_id = c.id
    LEFT JOIN comment_reactions my
      ON my.comment_id = c.id AND my.user_id = ? AND my.reaction = 'helpful'
    WHERE c.entry_id = ? AND c.is_public = 1
    ORDER BY c.created_at DESC
  `).all(viewerId, entryId).map(row => ({
    id: row.id,
    entryId: row.entry_id,
    contributorId: row.user_id || '',
    contributorName: row.contributor_name || (row.user_id ? row.author : ''),
    author: row.author,
    body: row.body,
    model: row.model || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canDelete: canDeleteAsset(row, viewer),
    canEdit: canDeleteAsset(row, viewer),
    helpfulCount: Number(row.helpful_count) || 0,
    helpfulByMe: Boolean(row.helpful_by_me),
  }));
}

function getUserComments(userId, { limit = 100 } = {}) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
  return db.prepare(`
    SELECT c.id, c.entry_id, c.author, c.body, c.model, c.created_at, c.updated_at,
           e.source_id, e.title, e.link, e.published, e.published_ts,
           t.title_zh, t.title_hash AS translation_title_hash,
           u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM commentaries c
    JOIN entries e ON e.id = c.entry_id
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    LEFT JOIN (
      SELECT comment_id, COUNT(*) AS helpful_count
      FROM comment_reactions
      WHERE reaction = 'helpful'
      GROUP BY comment_id
    ) r ON r.comment_id = c.id
    WHERE c.user_id = ? AND c.is_public = 1
      AND COALESCE(e.deleted_at, 0) = 0
    ORDER BY COALESCE(c.updated_at, c.created_at) DESC, c.created_at DESC
    LIMIT ?
  `).all(id, safeLimit).map(row => ({
    id: row.id,
    entryId: row.entry_id,
    contributorId: id,
    contributorName: row.contributor_name || row.author,
    author: row.author,
    body: row.body,
    bodySnippet: assetSnippet(row.body, 220),
    model: row.model || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    helpfulCount: Number(row.helpful_count) || 0,
    entry: {
      id: row.entry_id,
      sourceId: row.source_id,
      title: row.title,
      titleZh: validTranslatedTitle(row),
      link: row.link || '',
      published: row.published || null,
      publishedTs: row.published_ts || 0,
    },
  }));
}

function getUserEntryReactions(userId, { limit = 100, reaction = 'like' } = {}) {
  const id = String(userId || '').trim();
  const cleanReaction = String(reaction || '').trim().toLowerCase();
  if (!id || !['like', 'dislike'].includes(cleanReaction)) return [];
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
  const rows = db.prepare(`
    SELECT r.entry_id, r.reaction, r.created_at, r.updated_at,
           e.source_id, e.title, e.link, e.author, e.published, e.published_ts,
           e.summary, e.image,
           t.title_zh, t.summary_zh, t.title_hash AS translation_title_hash
    FROM entry_reactions r
    JOIN entries e ON e.id = r.entry_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    WHERE r.user_id = ? AND r.reaction = ?
      AND COALESCE(e.deleted_at, 0) = 0
    ORDER BY r.updated_at DESC, r.created_at DESC
    LIMIT ?
  `).all(id, cleanReaction, safeLimit);
  const stats = getEntryStats(rows.map(row => row.entry_id));
  return rows.map(row => {
    const entryStats = stats[row.entry_id] || emptyEntryStats(row.entry_id);
    return {
      id: row.entry_id,
      type: cleanReaction,
      entryId: row.entry_id,
      contributorId: id,
      reaction: row.reaction,
      title: row.title,
      titleZh: validTranslatedTitle(row),
      summary: row.summary || '',
      summaryZh: row.summary_zh || null,
      image: row.image || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      helpfulCount: Number(entryStats.likeCount) || 0,
      stats: entryStats,
      entry: {
        id: row.entry_id,
        sourceId: row.source_id,
        title: row.title,
        titleZh: validTranslatedTitle(row),
        link: row.link || '',
        author: row.author || '',
        published: row.published || null,
        publishedTs: row.published_ts || 0,
        summary: row.summary || '',
        summaryZh: row.summary_zh || null,
        image: row.image || null,
      },
    };
  });
}

function getUserTranslations(userId, { limit = 100 } = {}) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
  return db.prepare(`
    SELECT tr.id AS asset_id, tr.entry_id, tr.title AS title_zh, tr.summary AS summary_zh,
           tr.title_hash,
           tr.content_json, tr.model, tr.provider, tr.author, tr.created_at, tr.updated_at,
           e.source_id, e.title, e.link, e.published, e.published_ts,
           u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM entry_ai_asset_contributions tr
    JOIN entries e ON e.id = tr.entry_id
    LEFT JOIN users u ON u.id = tr.user_id
    LEFT JOIN (
      SELECT asset_id, COUNT(*) AS helpful_count
      FROM entry_asset_reactions
      WHERE reaction = 'helpful' AND asset_type = 'translation' AND asset_id <> ''
      GROUP BY asset_id
    ) r ON r.asset_id = tr.id
    WHERE tr.user_id = ?
      AND tr.asset_type = 'translation'
      AND tr.content_json IS NOT NULL
      AND tr.content_json <> ''
      AND tr.content_json <> '[]'
      AND COALESCE(e.deleted_at, 0) = 0
    ORDER BY tr.updated_at DESC, tr.created_at DESC
    LIMIT ?
  `).all(id, safeLimit).map(row => {
    const content = safeJsonParse(row.content_json, []);
    return {
      id: row.asset_id,
      type: 'translation',
      entryId: row.entry_id,
      contributorId: id,
      contributorName: row.contributor_name || row.author || '',
      author: row.author || row.contributor_name || '',
      titleZh: validTranslatedTitle(row, 'title', 'title_zh', 'title_hash') || '',
      summaryZh: row.summary_zh || '',
      contentSnippet: translationSnippet(content) || assetSnippet(row.summary_zh, 220),
      model: row.model || '',
      provider: row.provider || 'deepseek',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      helpfulCount: Number(row.helpful_count) || 0,
      entry: {
        id: row.entry_id,
        sourceId: row.source_id,
        title: row.title,
        titleZh: validTranslatedTitle(row, 'title', 'title_zh', 'title_hash'),
        link: row.link || '',
        published: row.published || null,
        publishedTs: row.published_ts || 0,
      },
    };
  });
}

function getUserRewrites(userId, { limit = 100 } = {}) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
  return db.prepare(`
    SELECT rw.id AS asset_id, rw.entry_id, rw.title AS rewrite_title, rw.body, rw.model, rw.provider,
           rw.author, rw.created_at, rw.updated_at,
           e.source_id, e.title, e.link, e.published, e.published_ts,
           tr.title_zh, tr.title_hash AS translation_title_hash,
           u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM entry_ai_asset_contributions rw
    JOIN entries e ON e.id = rw.entry_id
    LEFT JOIN entry_translations tr ON tr.entry_id = e.id
    LEFT JOIN users u ON u.id = rw.user_id
    LEFT JOIN (
      SELECT asset_id, COUNT(*) AS helpful_count
      FROM entry_asset_reactions
      WHERE reaction = 'helpful' AND asset_type = 'rewrite' AND asset_id <> ''
      GROUP BY asset_id
    ) r ON r.asset_id = rw.id
    WHERE rw.user_id = ?
      AND rw.asset_type = 'rewrite'
      AND rw.body IS NOT NULL
      AND rw.body <> ''
      AND COALESCE(e.deleted_at, 0) = 0
    ORDER BY rw.updated_at DESC, rw.created_at DESC
    LIMIT ?
  `).all(id, safeLimit).map(row => ({
    id: row.asset_id,
    type: 'rewrite',
    entryId: row.entry_id,
    contributorId: id,
    contributorName: row.contributor_name || row.author || '',
    author: row.author || row.contributor_name || '',
    title: row.rewrite_title || row.title || '',
    bodySnippet: assetSnippet(row.body, 220),
    model: row.model || '',
    provider: row.provider || 'deepseek',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    helpfulCount: Number(row.helpful_count) || 0,
    entry: {
      id: row.entry_id,
      sourceId: row.source_id,
      title: row.title,
      titleZh: validTranslatedTitle(row),
      link: row.link || '',
      published: row.published || null,
      publishedTs: row.published_ts || 0,
    },
  }));
}

function getComment(entryId, commentId) {
  const row = db.prepare(`
    SELECT id, entry_id, author, body, model, created_at, updated_at
    FROM commentaries
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, String(commentId || '').trim());
  if (!row) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    author: row.author,
    body: row.body,
    model: row.model || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function addComment(entryId, { userId = null, author, body, model = '' }) {
  const id = crypto.randomUUID();
  const t = now();
  db.prepare(`
    INSERT INTO commentaries (id, entry_id, user_id, author, body, model, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, entryId, userId, publicAuthor(author), String(body || '').trim().slice(0, 5000), model || '', t, t);
  return getComments(entryId).find(comment => comment.id === id);
}

function updateComment(entryId, commentId, { body = '' } = {}, viewer = null) {
  const id = String(commentId || '').trim();
  const row = db.prepare(`
    SELECT id, user_id
    FROM commentaries
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, id);
  if (!row) return false;
  if (!canDeleteAsset(row, viewer)) {
    const err = new Error('没有权限编辑这条点评');
    err.statusCode = 403;
    throw err;
  }
  const nextBody = String(body || '').trim().slice(0, 5000);
  if (!nextBody) {
    const err = new Error('comment body is required');
    err.statusCode = 400;
    throw err;
  }
  db.prepare('UPDATE commentaries SET body = ?, updated_at = ? WHERE entry_id = ? AND id = ?').run(nextBody, now(), entryId, id);
  return getComment(entryId, id);
}

function deleteComment(entryId, commentId, viewer = null) {
  const id = String(commentId || '').trim();
  const row = db.prepare(`
    SELECT id, user_id
    FROM commentaries
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, id);
  if (!row) return false;
  if (!canDeleteAsset(row, viewer)) {
    const err = new Error('没有权限撤回这条点评');
    err.statusCode = 403;
    throw err;
  }
  db.prepare('UPDATE commentaries SET is_public = 0, updated_at = ? WHERE entry_id = ? AND id = ?').run(now(), entryId, id);
  return true;
}

function setCommentHelpful(entryId, commentId, userId, helpful = true) {
  const id = String(commentId || '').trim();
  const row = db.prepare(`
    SELECT id
    FROM commentaries
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, id);
  if (!row) return false;
  if (helpful) {
    db.prepare(`
      INSERT OR IGNORE INTO comment_reactions (comment_id, user_id, reaction, created_at)
      VALUES (?, ?, 'helpful', ?)
    `).run(id, userId, now());
  } else {
    db.prepare(`
      DELETE FROM comment_reactions
      WHERE comment_id = ? AND user_id = ? AND reaction = 'helpful'
    `).run(id, userId);
  }
  return db.prepare(`
    SELECT
      COUNT(*) AS helpful_count,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS helpful_by_me
    FROM comment_reactions
    WHERE comment_id = ? AND reaction = 'helpful'
  `).get(userId, id);
}

function annotationReplyFromRow(row, viewer = null) {
  return {
    id: row.id,
    annotationId: row.annotation_id,
    entryId: row.entry_id,
    contributorId: row.user_id || '',
    contributorName: row.contributor_name || (row.user_id ? row.author : ''),
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canDelete: canDeleteAsset(row, viewer),
  };
}

function annotationFromRow(row, replies = [], viewer = null) {
  const replyList = Array.isArray(replies) ? replies : [];
  return {
    id: row.id,
    entryId: row.entry_id,
    surface: normalizeAnnotationSurface(row.surface),
    assetId: row.asset_id || '',
    contributorId: row.user_id || '',
    contributorName: row.contributor_name || (row.user_id ? row.author : ''),
    author: row.author,
    quote: row.quote || '',
    prefix: row.prefix || '',
    suffix: row.suffix || '',
    body: row.body || '',
    bodySnippet: assetSnippet(row.body || '', 220),
    quoteSnippet: assetSnippet(row.quote || '', 180),
    contentHash: row.content_hash || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canDelete: canDeleteAsset(row, viewer),
    canEdit: canDeleteAsset(row, viewer),
    helpfulCount: Number(row.helpful_count) || 0,
    helpfulByMe: Boolean(row.helpful_by_me),
    replyCount: replyList.length,
    replies: replyList,
  };
}

function getAnnotations(entryId, viewer = null) {
  const id = normalizeEntryId(entryId);
  if (!id) return [];
  const viewerId = viewer && viewer.id ? String(viewer.id) : '';
  const rows = db.prepare(`
    SELECT a.id, a.entry_id, a.surface, a.asset_id, a.user_id, a.author, a.quote, a.prefix, a.suffix,
           a.body, a.content_hash, a.created_at, a.updated_at,
           u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count,
           CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END AS helpful_by_me
    FROM text_annotations a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN (
      SELECT annotation_id, COUNT(*) AS helpful_count
      FROM text_annotation_reactions
      WHERE reaction = 'helpful'
      GROUP BY annotation_id
    ) r ON r.annotation_id = a.id
    LEFT JOIN text_annotation_reactions my
      ON my.annotation_id = a.id AND my.user_id = ? AND my.reaction = 'helpful'
    WHERE a.entry_id = ? AND a.is_public = 1
    ORDER BY a.updated_at DESC, a.created_at DESC
  `).all(viewerId, id);
  if (!rows.length) return [];
  const placeholders = rows.map(() => '?').join(',');
  const replies = db.prepare(`
    SELECT r.id, r.annotation_id, r.entry_id, r.user_id, r.author, r.body, r.created_at, r.updated_at,
           u.display_name AS contributor_name
    FROM text_annotation_replies r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.annotation_id IN (${placeholders}) AND r.is_public = 1
    ORDER BY r.created_at ASC
  `).all(...rows.map(row => row.id));
  const replyMap = new Map();
  for (const reply of replies) {
    const list = replyMap.get(reply.annotation_id) || [];
    list.push(annotationReplyFromRow(reply, viewer));
    replyMap.set(reply.annotation_id, list);
  }
  return rows.map(row => annotationFromRow(row, replyMap.get(row.id) || [], viewer));
}

function getAnnotation(entryId, annotationId, viewer = null) {
  const id = String(annotationId || '').trim();
  if (!id) return null;
  return getAnnotations(entryId, viewer).find(annotation => annotation.id === id) || null;
}

function getUserAnnotations(userId, { limit = 100 } = {}) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
  return db.prepare(`
    SELECT a.id, a.entry_id, a.surface, a.asset_id, a.author, a.quote, a.prefix, a.suffix,
           a.body, a.content_hash, a.created_at, a.updated_at,
           e.source_id, e.title, e.link, e.published, e.published_ts,
           t.title_zh, t.title_hash AS translation_title_hash,
           u.display_name AS contributor_name,
           COALESCE(hr.helpful_count, 0) AS helpful_count,
           COALESCE(rr.reply_count, 0) AS reply_count
    FROM text_annotations a
    JOIN entries e ON e.id = a.entry_id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    LEFT JOIN (
      SELECT annotation_id, COUNT(*) AS helpful_count
      FROM text_annotation_reactions
      WHERE reaction = 'helpful'
      GROUP BY annotation_id
    ) hr ON hr.annotation_id = a.id
    LEFT JOIN (
      SELECT annotation_id, COUNT(*) AS reply_count
      FROM text_annotation_replies
      WHERE is_public = 1
      GROUP BY annotation_id
    ) rr ON rr.annotation_id = a.id
    WHERE a.user_id = ? AND a.is_public = 1
      AND COALESCE(e.deleted_at, 0) = 0
    ORDER BY COALESCE(a.updated_at, a.created_at) DESC, a.created_at DESC
    LIMIT ?
  `).all(id, safeLimit).map(row => ({
    id: row.id,
    type: 'annotations',
    entryId: row.entry_id,
    contributorId: id,
    contributorName: row.contributor_name || row.author,
    author: row.author,
    surface: normalizeAnnotationSurface(row.surface),
    assetId: row.asset_id || '',
    quote: row.quote || '',
    quoteSnippet: assetSnippet(row.quote || '', 180),
    body: row.body || '',
    bodySnippet: assetSnippet(row.body || '', 220),
    contentHash: row.content_hash || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    helpfulCount: Number(row.helpful_count) || 0,
    replyCount: Number(row.reply_count) || 0,
    entry: {
      id: row.entry_id,
      sourceId: row.source_id,
      title: row.title,
      titleZh: validTranslatedTitle(row),
      link: row.link || '',
      published: row.published || null,
      publishedTs: row.published_ts || 0,
    },
  }));
}

function addAnnotation(entryId, {
  surface = 'original',
  assetId = '',
  userId = null,
  author,
  quote,
  prefix = '',
  suffix = '',
  body,
  contentHash = '',
}) {
  const id = crypto.randomUUID();
  const t = now();
  const cleanQuote = String(quote || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  const cleanBody = String(body || '').trim().slice(0, 5000);
  if (!cleanQuote) {
    const err = new Error('annotation quote is required');
    err.statusCode = 400;
    throw err;
  }
  db.prepare(`
    INSERT INTO text_annotations (
      id, entry_id, surface, asset_id, user_id, author, quote, prefix, suffix, body,
      content_hash, is_public, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    entryId,
    normalizeAnnotationSurface(surface),
    normalizeAiAssetId(assetId),
    userId,
    publicAuthor(author),
    cleanQuote,
    String(prefix || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    String(suffix || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    cleanBody,
    String(contentHash || '').slice(0, 120),
    t,
    t,
  );
  return getAnnotation(entryId, id);
}

function addAnnotationReply(entryId, annotationId, { userId = null, author, body }) {
  const parent = db.prepare(`
    SELECT id
    FROM text_annotations
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, String(annotationId || '').trim());
  if (!parent) return null;
  const cleanBody = String(body || '').trim().slice(0, 5000);
  if (!cleanBody) {
    const err = new Error('reply body is required');
    err.statusCode = 400;
    throw err;
  }
  const id = crypto.randomUUID();
  const t = now();
  db.prepare(`
    INSERT INTO text_annotation_replies (id, annotation_id, entry_id, user_id, author, body, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, parent.id, entryId, userId, publicAuthor(author), cleanBody, t, t);
  db.prepare('UPDATE text_annotations SET updated_at = ? WHERE entry_id = ? AND id = ?').run(t, entryId, parent.id);
  return getAnnotation(entryId, parent.id);
}

function deleteAnnotation(entryId, annotationId, viewer = null) {
  const id = String(annotationId || '').trim();
  const row = db.prepare(`
    SELECT id, user_id
    FROM text_annotations
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, id);
  if (!row) return false;
  if (!canDeleteAsset(row, viewer)) {
    const err = new Error('没有权限撤回这条划线点评');
    err.statusCode = 403;
    throw err;
  }
  const t = now();
  db.prepare('UPDATE text_annotations SET is_public = 0, updated_at = ? WHERE entry_id = ? AND id = ?').run(t, entryId, id);
  db.prepare('UPDATE text_annotation_replies SET is_public = 0, updated_at = ? WHERE entry_id = ? AND annotation_id = ?').run(t, entryId, id);
  return true;
}

function setAnnotationHelpful(entryId, annotationId, userId, helpful = true) {
  const id = String(annotationId || '').trim();
  const row = db.prepare(`
    SELECT id
    FROM text_annotations
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, id);
  if (!row) return false;
  if (helpful) {
    db.prepare(`
      INSERT OR IGNORE INTO text_annotation_reactions (annotation_id, user_id, reaction, created_at)
      VALUES (?, ?, 'helpful', ?)
    `).run(id, userId, now());
  } else {
    db.prepare(`
      DELETE FROM text_annotation_reactions
      WHERE annotation_id = ? AND user_id = ? AND reaction = 'helpful'
    `).run(id, userId);
  }
  return db.prepare(`
    SELECT
      COUNT(*) AS helpful_count,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS helpful_by_me
    FROM text_annotation_reactions
    WHERE annotation_id = ? AND reaction = 'helpful'
  `).get(userId, id);
}

function getAnnotationNotificationTarget(entryId, annotationId, suffix = '觉得') {
  const row = db.prepare(`
    SELECT a.id, a.user_id, a.quote, a.body, e.title, t.title_zh,
           t.title_hash AS translation_title_hash
    FROM text_annotations a
    JOIN entries e ON e.id = a.entry_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    WHERE a.entry_id = ? AND a.id = ? AND a.is_public = 1
  `).get(entryId, String(annotationId || '').trim());
  return row ? {
    userId: row.user_id || '',
    objectId: row.id,
    message: `有人${suffix}你的划线点评：${assetSnippet(row.quote || validTranslatedTitle(row) || row.title || row.body, 80)}`,
  } : null;
}

function setChatMessageHelpful(entryId, messageId, userId, helpful = true) {
  const id = String(messageId || '').trim();
  const row = db.prepare(`
    SELECT id
    FROM chat_messages
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, id);
  if (!row) return false;
  if (helpful) {
    db.prepare(`
      INSERT OR IGNORE INTO chat_reactions (message_id, user_id, reaction, created_at)
      VALUES (?, ?, 'helpful', ?)
    `).run(id, userId, now());
  } else {
    db.prepare(`
      DELETE FROM chat_reactions
      WHERE message_id = ? AND user_id = ? AND reaction = 'helpful'
    `).run(id, userId);
  }
  return db.prepare(`
    SELECT
      COUNT(*) AS helpful_count,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS helpful_by_me
    FROM chat_reactions
    WHERE message_id = ? AND reaction = 'helpful'
  `).get(userId, id);
}

function getEntryAssetReaction(entryId, type, viewer = null, assetId = '') {
  const id = normalizeEntryId(entryId);
  const assetType = normalizeAssetReactionType(type);
  const aiAssetId = normalizeAiAssetId(assetId);
  const viewerId = viewer && viewer.id ? String(viewer.id) : '';
  if (!id || !assetType) {
    return { helpfulCount: 0, helpfulByMe: false };
  }
  const row = db.prepare(`
    SELECT
      COUNT(*) AS helpful_count,
      MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS helpful_by_me
    FROM entry_asset_reactions
    WHERE entry_id = ? AND asset_type = ? AND asset_id = ? AND reaction = 'helpful'
  `).get(viewerId, id, assetType, aiAssetId);
  return {
    helpfulCount: Number(row && row.helpful_count) || 0,
    helpfulByMe: Boolean(row && row.helpful_by_me),
  };
}

function setEntryAssetHelpful(entryId, type, userId, helpful = true, assetId = '') {
  const id = normalizeEntryId(entryId);
  const assetType = normalizeAssetReactionType(type);
  const aiAssetId = normalizeAiAssetId(assetId);
  if (!id || !assetType || !hasEntryAsset(id, assetType, aiAssetId)) return false;
  if (helpful) {
    db.prepare(`
      INSERT OR IGNORE INTO entry_asset_reactions (entry_id, asset_type, asset_id, user_id, reaction, created_at)
      VALUES (?, ?, ?, ?, 'helpful', ?)
    `).run(id, assetType, aiAssetId, userId, now());
  } else {
    db.prepare(`
      DELETE FROM entry_asset_reactions
      WHERE entry_id = ? AND asset_type = ? AND asset_id = ? AND user_id = ? AND reaction = 'helpful'
    `).run(id, assetType, aiAssetId, userId);
  }
  const row = getEntryAssetReaction(id, assetType, { id: userId }, aiAssetId);
  return {
    helpful_count: row.helpfulCount,
    helpful_by_me: row.helpfulByMe ? 1 : 0,
  };
}

function getCommentNotificationTarget(entryId, commentId) {
  const row = db.prepare(`
    SELECT c.id, c.user_id, c.body, e.title, t.title_zh,
           t.title_hash AS translation_title_hash
    FROM commentaries c
    JOIN entries e ON e.id = c.entry_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    WHERE c.entry_id = ? AND c.id = ? AND c.is_public = 1
  `).get(entryId, String(commentId || '').trim());
  return row ? {
    userId: row.user_id || '',
    objectId: row.id,
    message: `有人觉得你的点评有用：${assetSnippet(validTranslatedTitle(row) || row.title || row.body, 80)}`,
  } : null;
}

function getChatNotificationTarget(entryId, messageId) {
  const row = db.prepare(`
    SELECT m.id, m.user_id, m.content, e.title, t.title_zh,
           t.title_hash AS translation_title_hash
    FROM chat_messages m
    JOIN entries e ON e.id = m.entry_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    WHERE m.entry_id = ? AND m.id = ? AND m.is_public = 1
  `).get(entryId, String(messageId || '').trim());
  return row ? {
    userId: row.user_id || '',
    objectId: row.id,
    message: `有人觉得你的文章对话有用：${assetSnippet(validTranslatedTitle(row) || row.title || row.content, 80)}`,
  } : null;
}

function getEntryAssetNotificationTarget(entryId, type, assetId = '') {
  const id = normalizeEntryId(entryId);
  const assetType = normalizeAssetReactionType(type);
  const aiAssetId = normalizeAiAssetId(assetId);
  if (!id || !assetType) return null;
  if (aiAssetId) {
    const row = db.prepare(`
      SELECT c.id, c.user_id, c.title AS asset_title, c.title_hash AS asset_title_hash,
             c.body, c.summary, e.title AS entry_title,
             t.title_zh AS entry_title_zh, t.title_hash AS translation_title_hash
      FROM entry_ai_asset_contributions c
      JOIN entries e ON e.id = c.entry_id
      LEFT JOIN entry_translations t ON t.entry_id = e.id
      WHERE c.entry_id = ? AND c.asset_type = ? AND c.id = ?
    `).get(id, assetType, aiAssetId);
    if (!row) return null;
    const entryTitleZh = validTranslatedTitle(row, 'entry_title', 'entry_title_zh');
    const assetTitle = assetType === 'translation'
      ? validTranslatedTitle(row, 'entry_title', 'asset_title', 'asset_title_hash')
      : row.asset_title;
    return {
      userId: row.user_id || '',
      objectId: row.id,
      message: `有人觉得你的${assetType === 'translation' ? '中文翻译' : '中文改写'}有用：${assetSnippet(entryTitleZh || row.entry_title || assetTitle || row.summary || row.body, 80)}`,
    };
  }
  const row = assetType === 'translation'
    ? db.prepare(`
      SELECT tr.user_id, tr.title_zh, tr.title_hash AS translation_title_hash,
             e.title AS entry_title
      FROM entry_translations tr
      JOIN entries e ON e.id = tr.entry_id
      WHERE tr.entry_id = ?
    `).get(id)
    : db.prepare(`
      SELECT rw.user_id, rw.title AS asset_title, rw.body, e.title AS entry_title,
             tr.title_zh, tr.title_hash AS translation_title_hash
      FROM entry_rewrites rw
      JOIN entries e ON e.id = rw.entry_id
      LEFT JOIN entry_translations tr ON tr.entry_id = e.id
      WHERE rw.entry_id = ?
    `).get(id);
  return row ? {
    userId: row.user_id || '',
    objectId: '',
    message: `有人觉得你的${assetType === 'translation' ? '中文翻译' : '中文改写'}有用：${assetSnippet(validTranslatedTitle(row, 'entry_title') || row.entry_title || row.asset_title || row.body, 80)}`,
  } : null;
}

function getEntrySubmissionOwner(entryId) {
  const id = normalizeEntryId(entryId);
  if (!id) return null;
  const row = db.prepare(`
    SELECT s.user_id, s.entry_id, e.title, t.title_zh,
           t.title_hash AS translation_title_hash
    FROM user_submissions s
    JOIN entries e ON e.id = s.entry_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    WHERE s.entry_id = ?
  `).get(id);
  return row ? {
    userId: row.user_id || '',
    objectId: row.entry_id,
    message: `有人反馈了你提交的链接：${assetSnippet(validTranslatedTitle(row) || row.title, 80)}`,
  } : null;
}

function getChatMessages(entryId, viewer = null) {
  const viewerId = viewer && viewer.id ? String(viewer.id) : '';
  return db.prepare(`
    SELECT m.id, m.entry_id, m.user_id, m.role, m.author, m.content, m.model, m.created_at,
           u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count,
           CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END AS helpful_by_me
    FROM chat_messages m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN (
      SELECT message_id, COUNT(*) AS helpful_count
      FROM chat_reactions
      WHERE reaction = 'helpful'
      GROUP BY message_id
    ) r ON r.message_id = m.id
    LEFT JOIN chat_reactions my
      ON my.message_id = m.id AND my.user_id = ? AND my.reaction = 'helpful'
    WHERE m.entry_id = ? AND m.is_public = 1
    ORDER BY m.created_at ASC
  `).all(viewerId, entryId).map(row => ({
    id: row.id,
    entryId: row.entry_id,
    contributorId: row.user_id || '',
    contributorName: row.contributor_name || '',
    role: row.role,
    author: row.author,
    content: row.content,
    model: row.model || '',
    createdAt: row.created_at,
    canDelete: canDeleteAsset(row, viewer),
    helpfulCount: Number(row.helpful_count) || 0,
    helpfulByMe: Boolean(row.helpful_by_me),
  }));
}

function getUserChatMessages(userId, { limit = 100 } = {}) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
  return db.prepare(`
    SELECT m.id, m.entry_id, m.role, m.author, m.content, m.model, m.created_at,
           e.source_id, e.title, e.link, e.published, e.published_ts,
           t.title_zh, t.title_hash AS translation_title_hash,
           u.display_name AS contributor_name,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM chat_messages m
    JOIN entries e ON e.id = m.entry_id
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN entry_translations t ON t.entry_id = e.id
    LEFT JOIN (
      SELECT message_id, COUNT(*) AS helpful_count
      FROM chat_reactions
      WHERE reaction = 'helpful'
      GROUP BY message_id
    ) r ON r.message_id = m.id
    WHERE m.user_id = ? AND m.is_public = 1
      AND COALESCE(e.deleted_at, 0) = 0
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(id, safeLimit).map(row => ({
    id: row.id,
    entryId: row.entry_id,
    contributorId: id,
    contributorName: row.contributor_name || '',
    role: row.role,
    author: row.author,
    content: row.content,
    contentSnippet: assetSnippet(row.content, 220),
    model: row.model || '',
    createdAt: row.created_at,
    helpfulCount: Number(row.helpful_count) || 0,
    entry: {
      id: row.entry_id,
      sourceId: row.source_id,
      title: row.title,
      titleZh: validTranslatedTitle(row),
      link: row.link || '',
      published: row.published || null,
      publishedTs: row.published_ts || 0,
    },
  }));
}

function getChatMessage(entryId, messageId) {
  const row = db.prepare(`
    SELECT m.id, m.entry_id, m.role, m.author, m.content, m.model, m.created_at,
           COALESCE(r.helpful_count, 0) AS helpful_count
    FROM chat_messages m
    LEFT JOIN (
      SELECT message_id, COUNT(*) AS helpful_count
      FROM chat_reactions
      WHERE reaction = 'helpful'
      GROUP BY message_id
    ) r ON r.message_id = m.id
    WHERE m.entry_id = ? AND m.id = ? AND m.is_public = 1
  `).get(entryId, String(messageId || '').trim());
  if (!row) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    role: row.role,
    author: row.author,
    content: row.content,
    model: row.model || '',
    createdAt: row.created_at,
    helpfulCount: Number(row.helpful_count) || 0,
  };
}

function addChatMessage(entryId, { userId = null, role, author, content, model = '' }) {
  const id = crypto.randomUUID();
  const t = now();
  db.prepare(`
    INSERT INTO chat_messages (id, entry_id, user_id, role, author, content, model, is_public, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    entryId,
    userId,
    role === 'assistant' ? 'assistant' : 'user',
    publicAuthor(author),
    String(content || '').trim().slice(0, 6000),
    model || '',
    t,
  );
  return getChatMessages(entryId).find(message => message.id === id);
}

function deleteChatMessage(entryId, messageId, viewer = null) {
  const id = String(messageId || '').trim();
  const row = db.prepare(`
    SELECT id, user_id
    FROM chat_messages
    WHERE entry_id = ? AND id = ? AND is_public = 1
  `).get(entryId, id);
  if (!row) return false;
  if (!canDeleteAsset(row, viewer)) {
    const err = new Error('没有权限撤回这条对话');
    err.statusCode = 403;
    throw err;
  }
  db.prepare('UPDATE chat_messages SET is_public = 0 WHERE entry_id = ? AND id = ?').run(entryId, id);
  return true;
}

function logRefreshJob(kind, status, message = '') {
  const id = crypto.randomUUID();
  const t = now();
  db.prepare(`
    INSERT INTO refresh_jobs (id, kind, status, message, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, kind, status, String(message || '').slice(0, 500), t, status === 'started' ? null : t);
  return id;
}

module.exports = {
  addAnnotation,
  addAnnotationReply,
  addChatMessage,
  addComment,
  authenticateUser,
  createSession,
  createUser,
  createNotification,
  createSubmissionRequest,
  deleteAnnotation,
  deleteChatMessage,
  deleteComment,
  deleteSession,
  ensureAdminUser,
  getAnnotation,
  getAnnotationNotificationTarget,
  getAnnotations,
  getChatMessages,
  getChatMessage,
  getComment,
  getCommentNotificationTarget,
  getComments,
  getContributor,
  getContributors,
  getAiAssetContribution,
  getAdminSubmissionUsers,
  getAdminUserSubmissions,
  getAdminUsers,
  getChatNotificationTarget,
  getEntryAssetNotificationTarget,
  getEntryAiAssetPreviews,
  getEntry,
  getEntryByIdPrefix,
  getEntryAssetReaction,
  getEntryAssetSummaries,
  getEntryStats,
  getEntrySubmissionOwner,
  getRewrite,
  getSubmittedEntries,
  getSubmissionMeta,
  getSubmissionRequest,
  getSubmissionRequests,
  getTitleTranslations,
  getUserAnnotations,
  getUserTranslations,
  getUserRewrites,
  getUserChatMessages,
  getUserComments,
  getUserEntryReactions,
  getUserNotifications,
  getTranslation,
  getUserEntryState,
  getUserEntryStates,
  getUserBySessionToken,
  hashText,
  isEntryDeleted,
  logRefreshJob,
  markNotificationsRead,
  markEntryOriginalFetchAttempt,
  markEntriesRead,
  recordEntryView,
  reviewSubmissionRequest,
  saveTitleTranslations,
  saveTranslation,
  saveRewrite,
  saveSubmittedEntry,
  setEntryReaction,
  setEntryAssetHelpful,
  setChatMessageHelpful,
  setCommentHelpful,
  setAnnotationHelpful,
  setUserFollow,
  setUserEntryState,
  softDeleteEntry,
  softDeleteUserSubmissions,
  disableUserForModeration,
  restoreModeratedUser,
  updateComment,
  updateEntryContent,
  updateUserPassword,
  updateUserProfile,
  upsertEntries,
};
