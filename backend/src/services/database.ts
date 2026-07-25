import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

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

const dataDir = path.dirname(dbPath);
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
      isFavorite INTEGER DEFAULT 0,
      sampler TEXT,
      scheduler TEXT,
      randomSelections TEXT,
      generationPrompt TEXT,
      generationParams TEXT,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      messageId TEXT NOT NULL,
      prompt TEXT NOT NULL,
      originalPrompt TEXT,
      sessionId TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE
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

    CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_queue_sessionId ON queue(sessionId);
    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    CREATE INDEX IF NOT EXISTS idx_llm_providers_userId ON llm_providers(userId);
  `);

  // Migrations
  const columnsToCheck = ['model', 'width', 'height', 'steps', 'cfg', 'workflow', 'status', 'thumbnailUrl', 'seed', 'duration', 'isFavorite', 'sampler', 'scheduler', 'randomSelections', 'generationPrompt', 'generationParams'];
  columnsToCheck.forEach(col => {
    try {
      db.prepare(`SELECT ${col} FROM messages LIMIT 1`).get();
    } catch (e) {
      let type = 'TEXT';
      if (col === 'cfg') type = 'REAL';
      else if (['width', 'height', 'steps', 'seed', 'duration', 'isFavorite'].includes(col)) type = 'INTEGER';
      db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${type}`);
      console.log(`[Migration] Added column ${col} to messages table`);
    }
  });

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
    db.prepare('INSERT INTO users (id, username, password, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(adminId, 'admin', passwordHash, 1, Date.now());
    
    db.prepare('UPDATE sessions SET userId = ? WHERE userId IS NULL').run(adminId);
    console.log('[Migration] Default admin user created and sessions migrated.');
  }
};

export default db;
