import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config.js';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

// Ensure database directory exists
const dbPath = config.database.url;
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Create SQLite connection
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export schema for convenience
export * from './schema.js';

// Initialize database with schema
export function initializeDatabase() {
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS niches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      voice_guidelines TEXT,
      target_audience TEXT,
      keywords TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discovery_schedules (
      id TEXT PRIMARY KEY,
      niche_id TEXT NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      config TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discovered_posts (
      id TEXT PRIMARY KEY,
      niche_id TEXT NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      schedule_id TEXT REFERENCES discovery_schedules(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT,
      author_level TEXT,
      metadata TEXT,
      pain_score REAL,
      pain_analysis TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      content_hash TEXT NOT NULL,
      discovered_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      discovered_post_id TEXT NOT NULL REFERENCES discovered_posts(id) ON DELETE CASCADE,
      niche_id TEXT NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step TEXT,
      progress INTEGER DEFAULT 0,
      voice_analysis TEXT,
      research TEXT,
      outline TEXT,
      error_message TEXT,
      error_stack TEXT,
      retry_count INTEGER DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content (
      id TEXT PRIMARY KEY,
      niche_id TEXT NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      job_id TEXT REFERENCES generation_jobs(id) ON DELETE SET NULL,
      discovered_post_id TEXT REFERENCES discovered_posts(id) ON DELETE SET NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      components TEXT,
      component_bundle TEXT,
      seo_score REAL,
      seo_analysis TEXT,
      slop_score REAL,
      slop_analysis TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      review_notes TEXT,
      published_at TEXT,
      published_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      alt_text TEXT,
      filename TEXT,
      file_path TEXT,
      width INTEGER,
      height INTEGER,
      mime_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      niche_id TEXT REFERENCES niches(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_discovered_posts_niche ON discovered_posts(niche_id);
    CREATE INDEX IF NOT EXISTS idx_discovered_posts_status ON discovered_posts(status);
    CREATE INDEX IF NOT EXISTS idx_discovered_posts_hash ON discovered_posts(content_hash);
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
    CREATE INDEX IF NOT EXISTS idx_content_slug ON content(slug);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_content_niche_slug ON content(niche_id, slug);
    CREATE INDEX IF NOT EXISTS idx_settings_niche_key ON settings(niche_id, key);
  `);
}

// Close database connection
export function closeDatabase() {
  sqlite.close();
}
