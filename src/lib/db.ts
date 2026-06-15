import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const isVercel = !!process.env.VERCEL
const DB_PATH = isVercel
  ? '/tmp/shorts.db'
  : path.join(process.cwd(), 'data', 'shorts.db')

if (!isVercel) {
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    initSchema(db)
  }
  return db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      coupang_url TEXT,
      commission_rate REAL DEFAULT 3.0,
      viral_score INTEGER DEFAULT 0,
      estimated_revenue INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      platform TEXT NOT NULL,
      hook TEXT,
      script TEXT,
      image_prompt TEXT,
      status TEXT DEFAULT 'draft',
      views INTEGER DEFAULT 0,
      revenue INTEGER DEFAULT 0,
      posted_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      username TEXT NOT NULL,
      followers INTEGER DEFAULT 0,
      total_revenue INTEGER DEFAULT 0,
      post_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS revenue_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER REFERENCES accounts(id),
      content_id INTEGER REFERENCES content(id),
      amount INTEGER NOT NULL,
      commission_type TEXT DEFAULT 'coupang_partners',
      logged_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_type TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      products_found INTEGER DEFAULT 0,
      content_generated INTEGER DEFAULT 0,
      posts_published INTEGER DEFAULT 0,
      error TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER REFERENCES content(id),
      platform TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      youtube_video_id TEXT,
      published_at TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS click_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER REFERENCES content(id),
      product_id INTEGER REFERENCES products(id),
      affiliate_url TEXT,
      ip_hash TEXT,
      user_agent TEXT,
      clicked_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'idle',
      current_task TEXT,
      last_result TEXT,
      total_runs INTEGER DEFAULT 0,
      success_runs INTEGER DEFAULT 0,
      revenue_contributed INTEGER DEFAULT 0,
      last_run_at TEXT,
      next_run_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      task_type TEXT NOT NULL,
      task_data TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS evolution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle INTEGER NOT NULL DEFAULT 1,
      insights TEXT,
      strategy_changes TEXT,
      top_product TEXT,
      top_platform TEXT,
      top_hook TEXT,
      performance_delta INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS revenue_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_type TEXT NOT NULL,
      account_name TEXT,
      bank_name TEXT,
      account_number_masked TEXT,
      account_holder TEXT,
      is_verified INTEGER DEFAULT 0,
      total_received INTEGER DEFAULT 0,
      last_settled_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO agent_states (agent_name, status)
    VALUES
      ('trend_agent', 'idle'),
      ('content_agent', 'idle'),
      ('publish_agent', 'idle'),
      ('revenue_agent', 'idle'),
      ('evolution_agent', 'idle');
  `)

  // Migration: add created_at to content if missing (for existing DBs)
  const cols = db.prepare(`PRAGMA table_info(content)`).all() as { name: string }[]
  if (!cols.some(c => c.name === 'created_at')) {
    db.exec(`ALTER TABLE content ADD COLUMN created_at TEXT`)
    db.exec(`UPDATE content SET created_at = datetime('now') WHERE created_at IS NULL`)
  }

  const accountCount = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }).c
  if (accountCount === 0) {
    seedAccounts(db)
  }
}

function seedAccounts(db: Database.Database) {
  const platforms = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver']
  const accountDistribution: Record<string, number> = {
    YouTube: 10, Instagram: 8, TikTok: 6, Facebook: 3, Threads: 2, Naver: 1,
  }
  const insert = db.prepare(
    'INSERT INTO accounts (platform, username, followers, total_revenue, post_count, status) VALUES (?, ?, ?, ?, ?, ?)'
  )
  platforms.forEach(platform => {
    const n = accountDistribution[platform]
    const prefix = platform === 'YouTube' ? 'yt' : platform === 'Instagram' ? 'ig' : platform.slice(0, 2).toLowerCase()
    for (let i = 1; i <= n; i++) {
      insert.run(platform, `shorts_${prefix}_${i}`, 0, 0, 0, 'active')
    }
  })
}

export type Product = {
  id: number
  name: string
  category: string
  coupang_url: string | null
  commission_rate: number
  viral_score: number
  estimated_revenue: number
  created_at: string
}

export type Content = {
  id: number
  product_id: number
  platform: string
  hook: string | null
  script: string | null
  image_prompt: string | null
  status: string
  views: number
  revenue: number
  posted_at: string | null
}

export type Account = {
  id: number
  platform: string
  username: string
  followers: number
  total_revenue: number
  post_count: number
  status: string
}

export type RevenueLog = {
  id: number
  account_id: number
  content_id: number
  amount: number
  commission_type: string
  logged_at: string
}

export type AutomationRun = {
  id: number
  run_type: string
  status: string
  products_found: number
  content_generated: number
  posts_published: number
  error: string | null
  started_at: string
  finished_at: string | null
}

export type ScheduledPost = {
  id: number
  content_id: number
  platform: string
  scheduled_for: string
  status: string
  youtube_video_id: string | null
  published_at: string | null
  error: string | null
  created_at: string
}
