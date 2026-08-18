/**
 * 数据库层（云端就绪）
 * ----------------------------------------------------------------
 * 使用 libSQL：同步 API，与 better-sqlite3 完全兼容，且同一份代码可同时运行于：
 *   1) 本地文件模式  —— DATABASE_URL=file:./data/physics.db（开发 / 单机云服务器）
 *   2) Turso 托管云库 —— DATABASE_URL=libsql://xxxx.turso.io  +  DATABASE_AUTH_TOKEN=***
 * 因此「题库 / 学生 / 错题」全部可存到云端，服务器关机也不丢数据。
 *
 * 所有上层代码（server.js / auth.js / generate.js / seed.js）的调用方式保持不变。
 */
const path = require('path');
const fs = require('fs');
const Database = require('libsql');

// 加载 .env（云端部署时可不依赖此文件，直接用环境变量注入）
require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 数据库连接地址：默认本地文件；生产环境配置为 Turso 云库即可
const DB_URL = process.env.DATABASE_URL || `file:${path.join(DATA_DIR, 'physics.db')}`;
const AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN || '';

// 是否为远程托管库（Turso / HTTPS）
const isRemote = /^libsql:|^https?:/i.test(DB_URL);

const db = AUTH_TOKEN
  ? new Database(DB_URL, { authToken: AUTH_TOKEN })
  : new Database(DB_URL);

// WAL / 外键约束仅在本地文件模式启用（远程托管库由服务端保证，本地设 PRAGMA 会报错）
if (!isRemote) {
  try { db.pragma('journal_mode = WAL'); } catch (e) { /* 忽略 */ }
  try { db.pragma('foreign_keys = ON'); } catch (e) { /* 忽略 */ }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS school_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade_id INTEGER,
  chapter_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  example TEXT,
  example_solution TEXT,
  FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE SET NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  lecture TEXT
);

CREATE TABLE IF NOT EXISTS question_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS difficulty (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  tier_id INTEGER,
  grade_id INTEGER,
  file_path TEXT,
  original_filename TEXT,
  file_type TEXT,
  parsed INTEGER DEFAULT 0,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (tier_id) REFERENCES school_tiers(id) ON DELETE SET NULL,
  FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER,
  grade_id INTEGER,
  chapter_id INTEGER,
  knowledge_point_id INTEGER,
  topic_id INTEGER,
  type_id INTEGER,
  difficulty_id INTEGER,
  content TEXT,
  image_path TEXT,
  solution TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE SET NULL,
  FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE SET NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id) ON DELETE SET NULL,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL,
  FOREIGN KEY (type_id) REFERENCES question_types(id) ON DELETE SET NULL,
  FOREIGN KEY (difficulty_id) REFERENCES difficulty(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grade_id INTEGER,
  school_name TEXT,
  school_tier_id INTEGER,
  overall_desc TEXT,
  weak_topics TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE SET NULL,
  FOREIGN KEY (school_tier_id) REFERENCES school_tiers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS error_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  source_name TEXT,
  content TEXT,
  image_path TEXT,
  knowledge_point_id INTEGER,
  topic_id INTEGER,
  type_id INTEGER,
  difficulty_id INTEGER,
  error_reason TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id) ON DELETE SET NULL,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL,
  FOREIGN KEY (type_id) REFERENCES question_types(id) ON DELETE SET NULL,
  FOREIGN KEY (difficulty_id) REFERENCES difficulty(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  exam_name TEXT,
  exam_date TEXT,
  full_score REAL,
  score REAL,
  topic_scores TEXT,
  type_scores TEXT,
  kp_scores TEXT,
  difficulty_scores TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generated_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  mode TEXT,
  config TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

function initSchema() {
  db.exec(SCHEMA);
  // 本地库兼容：旧库可能缺少 phone 列，安全补列（远程托管库 schema 已含该列，跳过）
  if (!isRemote) {
    try {
      const cols = db.prepare('PRAGMA table_info(admins)').all().map(c => c.name);
      if (!cols.includes('phone')) db.exec('ALTER TABLE admins ADD COLUMN phone TEXT;');
    } catch (e) { /* 忽略 */ }
  }
}
initSchema();

// 暴露连接信息，便于日志/运维核对
db.isRemote = isRemote;
db.url = isRemote ? DB_URL : '(local file)';

module.exports = db;
