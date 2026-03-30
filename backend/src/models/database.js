const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('../config');
const logger = require('../utils/logger');

let db;

function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

function initDb() {
  const dbPath = path.join(config.dataDir, 'plc_control.db');
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  seedAdmin();
  logger.info('Database initialized', { path: dbPath });
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      avatar_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
      updated_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
      updated_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_by TEXT,
      deleted_at TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (deleted_by) REFERENCES users(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_name_path
      ON files(name, path) WHERE is_deleted = 0;

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      mime_type TEXT,
      is_binary INTEGER NOT NULL DEFAULT 0,
      commit_message TEXT,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
      FOREIGN KEY (file_id) REFERENCES files(id),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_versions_file_id ON versions(file_id);

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      entity_name TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
  `);
}

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(config.admin.username);
  if (!existing) {
    const { v4: uuidv4 } = require('uuid');
    const passwordHash = bcrypt.hashSync(config.admin.password, 10);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role)
      VALUES (?, ?, ?, ?, 'admin')
    `).run(uuidv4(), config.admin.username, passwordHash, config.admin.displayName);
    logger.info('Default admin user created', { username: config.admin.username });
  }
}

module.exports = { initDb, getDb };
