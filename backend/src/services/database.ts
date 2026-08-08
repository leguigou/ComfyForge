import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { syncPromptTags } from './prompt-tags';

export const DATABASE_SCHEMA_VERSION = 5;

// Standardized path for Docker, local development, and isolated tests.
let dbPath: string;
if (process.env.DATABASE_PATH) {
  dbPath = path.resolve(process.env.DATABASE_PATH);
} else {
  let dataDir: string;
  if (fs.existsSync('/app/backend/data')) {
    dataDir = '/app/backend/data';
  } else if (fs.existsSync('/app/data')) {
    dataDir = '/app/data';
  } else {
    const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
    dataDir = path.join(backendDir, 'data');
  }
  dbPath = path.join(dataDir, 'history.db');
}

export const databaseDataDir = path.dirname(dbPath);
const dataDir = databaseDataDir;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

console.log(`[Database] Initializing at: ${dbPath}`);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -2000'); // ~2MB cache

export const initDatabase = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      isAdmin INTEGER DEFAULT 0,
      avatarUrl TEXT,
      queueLimit INTEGER,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT,
      title TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      isArchived INTEGER DEFAULT 0,
      lastImageAt INTEGER DEFAULT 0,
      lastViewedAt INTEGER DEFAULT 0,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT,
      prompt TEXT,
      imageUrl TEXT,
      thumbnailUrl TEXT,
      timestamp INTEGER NOT NULL,
      model TEXT,
      width INTEGER,
      height INTEGER,
      steps INTEGER,
      cfg REAL,
      workflow TEXT,
      status TEXT DEFAULT 'completed',
      seed INTEGER,
      duration INTEGER,
      generationStartedAt INTEGER,
      isFavorite INTEGER DEFAULT 0,
      isPromptFavorite INTEGER DEFAULT 0,
      sampler TEXT,
      scheduler TEXT,
      randomSelections TEXT,
      generationPrompt TEXT,
      generationParams TEXT,
      comparisonMessageId TEXT,
      comparisonSourceId TEXT,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comparison_preferences (
      userId TEXT NOT NULL,
      sourceMessageId TEXT NOT NULL,
      firstMessageId TEXT NOT NULL,
      secondMessageId TEXT NOT NULL,
      preferredMessageId TEXT,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (userId, firstMessageId, secondMessageId),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (sourceMessageId) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (firstMessageId) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (secondMessageId) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (preferredMessageId) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      messageId TEXT NOT NULL,
      userId TEXT,
      prompt TEXT NOT NULL,
      originalPrompt TEXT,
      sessionId TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      userId TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS llm_providers (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      baseUrl TEXT NOT NULL,
      model TEXT NOT NULL,
      apiKey TEXT,
      isActive INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vision_prompt_recoveries (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT,
      importUrl TEXT,
      width INTEGER,
      height INTEGER,
      error TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      labelFr TEXT NOT NULL,
      labelEn TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_tags (
      messageId TEXT NOT NULL,
      tagId TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto',
      confidence REAL NOT NULL DEFAULT 1,
      PRIMARY KEY (messageId, tagId),
      FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      direction TEXT,
      event TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT,
      durationMs INTEGER,
      userId TEXT,
      sessionId TEXT,
      messageId TEXT,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_sessions_library ON sessions(userId, isArchived, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp ON messages(sessionId, timestamp DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_comparison_preferences_source ON comparison_preferences(userId, sourceMessageId);
    CREATE INDEX IF NOT EXISTS idx_queue_sessionId ON queue(sessionId);
    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    CREATE INDEX IF NOT EXISTS idx_llm_providers_userId ON llm_providers(userId);
    CREATE INDEX IF NOT EXISTS idx_vision_recoveries_user_updated
      ON vision_prompt_recoveries(userId, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_message_tags_tagId ON message_tags(tagId);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_level ON audit_logs(level);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_source ON audit_logs(source);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_userId ON audit_logs(userId);
  `);

  try {
    db.prepare('SELECT direction FROM audit_logs LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE audit_logs ADD COLUMN direction TEXT');
    console.log('[Migration] Added direction column to audit_logs table');
  }

  // Migrations
  const columnsToCheck = ['model', 'width', 'height', 'steps', 'cfg', 'workflow', 'status', 'thumbnailUrl', 'seed', 'duration', 'generationStartedAt', 'isFavorite', 'isPromptFavorite', 'sampler', 'scheduler', 'randomSelections', 'generationPrompt', 'generationParams', 'comparisonMessageId', 'comparisonSourceId'];
  columnsToCheck.forEach(col => {
    try {
      db.prepare(`SELECT ${col} FROM messages LIMIT 1`).get();
    } catch (e) {
      let type = 'TEXT';
      if (col === 'cfg') type = 'REAL';
      else if (['width', 'height', 'steps', 'seed', 'duration', 'generationStartedAt', 'isFavorite', 'isPromptFavorite'].includes(col)) type = 'INTEGER';
      db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${type}`);
      console.log(`[Migration] Added column ${col} to messages table`);
    }
  });
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_comparison_status
      ON messages(comparisonSourceId, status, timestamp DESC);
  `);

  // Direction was added after bidirectional comparison links. Recover older
  // generated comparison rows from their internal queue parameter.
  db.prepare(`
    UPDATE messages
    SET comparisonSourceId = comparisonMessageId
    WHERE comparisonSourceId IS NULL
      AND comparisonMessageId IS NOT NULL
      AND generationParams LIKE '%"unloadBeforeRun":%'
  `).run();

  try {
    db.prepare('SELECT userId FROM sessions LIMIT 1').get();
  } catch (e) {
    db.exec('ALTER TABLE sessions ADD COLUMN userId TEXT');
    console.log('[Migration] Added userId column to sessions table');
  }

  for (const column of ['lastImageAt', 'lastViewedAt']) {
    try {
      db.prepare(`SELECT ${column} FROM sessions LIMIT 1`).get();
    } catch {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${column} INTEGER DEFAULT 0`);
      console.log(`[Migration] Added ${column} column to sessions table`);
    }
  }

  try {
    db.prepare('SELECT avatarUrl FROM users LIMIT 1').get();
  } catch (e) {
    db.exec('ALTER TABLE users ADD COLUMN avatarUrl TEXT');
    console.log('[Migration] Added avatarUrl column to users table');
  }

  let currentSchemaVersion = Number(db.pragma('user_version', { simple: true })) || 0;
  if (currentSchemaVersion < 2) {
    db.transaction(() => {
      try {
        db.prepare('SELECT userId FROM queue LIMIT 1').get();
      } catch {
        db.exec('ALTER TABLE queue ADD COLUMN userId TEXT');
      }
      db.exec(`
        UPDATE queue
        SET userId = (
          SELECT sessions.userId FROM sessions WHERE sessions.id = queue.sessionId
        )
        WHERE userId IS NULL;
        CREATE INDEX IF NOT EXISTS idx_queue_user_status_created
          ON queue(userId, status, createdAt);
      `);
      db.pragma('user_version = 2');
    })();
    currentSchemaVersion = 2;
  }

  if (currentSchemaVersion < 3) {
    db.transaction(() => {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
          messageId UNINDEXED,
          generationPrompt,
          prompt,
          text
        );

        DELETE FROM message_search;
        INSERT INTO message_search (messageId, generationPrompt, prompt, text)
        SELECT id, COALESCE(generationPrompt, ''), COALESCE(prompt, ''), COALESCE(text, '')
        FROM messages;

        CREATE TRIGGER IF NOT EXISTS messages_search_insert AFTER INSERT ON messages BEGIN
          INSERT INTO message_search (messageId, generationPrompt, prompt, text)
          VALUES (new.id, COALESCE(new.generationPrompt, ''), COALESCE(new.prompt, ''), COALESCE(new.text, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS messages_search_update
        AFTER UPDATE OF generationPrompt, prompt, text ON messages BEGIN
          DELETE FROM message_search WHERE messageId = old.id;
          INSERT INTO message_search (messageId, generationPrompt, prompt, text)
          VALUES (new.id, COALESCE(new.generationPrompt, ''), COALESCE(new.prompt, ''), COALESCE(new.text, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS messages_search_delete AFTER DELETE ON messages BEGIN
          DELETE FROM message_search WHERE messageId = old.id;
        END;
      `);
      db.pragma('user_version = 3');
    })();
    currentSchemaVersion = 3;
  }

  if (currentSchemaVersion < 4) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS vision_prompt_recoveries (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          status TEXT NOT NULL,
          prompt TEXT,
          importUrl TEXT,
          width INTEGER,
          height INTEGER,
          error TEXT,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_vision_recoveries_user_updated
          ON vision_prompt_recoveries(userId, updatedAt DESC);
      `);
      db.pragma('user_version = 4');
    })();
    currentSchemaVersion = 4;
  }

  if (currentSchemaVersion < 5) {
    db.transaction(() => {
      try {
        db.prepare('SELECT queueLimit FROM users LIMIT 1').get();
      } catch {
        db.exec('ALTER TABLE users ADD COLUMN queueLimit INTEGER');
      }

      // Preserve the previous global behavior for existing accounts. Once the
      // migration is complete, NULL is reserved for an explicitly unlimited
      // per-user quota.
      const configuredDefault = Number.parseInt(process.env.MAX_QUEUE_PER_USER || '', 10);
      const defaultQueueLimit = Number.isFinite(configuredDefault) && configuredDefault > 0
        ? Math.min(configuredDefault, 500)
        : 25;
      db.prepare('UPDATE users SET queueLimit = ? WHERE queueLimit IS NULL').run(defaultQueueLimit);
      db.pragma('user_version = 5');
    })();
  }

  // Default Admin
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;

  if (userCount.count === 0) {
    const APP_PASSWORD = process.env.APP_PASSWORD;
    if (!APP_PASSWORD || APP_PASSWORD.trim().length < 12) {
      throw new Error('APP_PASSWORD must contain at least 12 characters when creating the first admin user.');
    }
    console.log('[Migration] Creating default admin user...');
    const adminId = uuidv4();
    const passwordHash = bcrypt.hashSync(APP_PASSWORD.trim(), 10);
    const configuredDefault = Number.parseInt(process.env.MAX_QUEUE_PER_USER || '', 10);
    const defaultQueueLimit = Number.isFinite(configuredDefault) && configuredDefault > 0
      ? Math.min(configuredDefault, 500)
      : 25;
    db.prepare('INSERT INTO users (id, username, password, isAdmin, queueLimit, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(adminId, 'admin', passwordHash, 1, defaultQueueLimit, Date.now());
    
    db.prepare('UPDATE sessions SET userId = ? WHERE userId IS NULL').run(adminId);
    console.log('[Migration] Default admin user created and sessions migrated.');
  }

  syncPromptTags(db);
};

export default db;
