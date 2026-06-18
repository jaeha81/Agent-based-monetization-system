import { createClient, type Client } from '@libsql/client'
import path from 'path'
import fs from 'fs'

const isVercel = !!process.env.VERCEL
const TURSO_URL = process.env.TURSO_DATABASE_URL
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN

function getDbUrl(): string {
  if (TURSO_URL) return TURSO_URL
  if (isVercel) return 'file:/tmp/shorts.db'
  const localPath = path.join(process.cwd(), 'data', 'shorts.db')
  const dir = path.dirname(localPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return `file:${localPath}`
}

let _client: Client | null = null
let _initPromise: Promise<void> | null = null

function getClient(): Client {
  if (!_client) {
    const config: Parameters<typeof createClient>[0] = { url: getDbUrl() }
    if (TURSO_AUTH_TOKEN) config.authToken = TURSO_AUTH_TOKEN
    _client = createClient(config)
  }
  return _client
}

async function ensureInit(): Promise<Client> {
  const client = getClient()
  if (!_initPromise) _initPromise = initSchema(client)
  await _initPromise
  return client
}

export type DbArgs = (null | string | number | bigint | boolean | ArrayBuffer | Uint8Array)[]

export async function query<T = Record<string, unknown>>(sql: string, args: DbArgs = []): Promise<T[]> {
  const client = await ensureInit()
  const r = await client.execute({ sql, args })
  return r.rows.map(row => {
    const obj: Record<string, unknown> = {}
    for (const col of r.columns) {
      const v = row[col]
      obj[col] = typeof v === 'bigint' ? Number(v) : (v ?? null)
    }
    return obj
  }) as unknown as T[]
}

export async function queryOne<T = Record<string, unknown>>(sql: string, args: DbArgs = []): Promise<T | undefined> {
  const rows = await query<T>(sql, args)
  return rows[0]
}

export async function execute(sql: string, args: DbArgs = []): Promise<{ lastInsertRowid: number; rowsAffected: number }> {
  const client = await ensureInit()
  const r = await client.execute({ sql, args })
  return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), rowsAffected: r.rowsAffected }
}

const SCHEMA_STMTS = [
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    coupang_url TEXT,
    commission_rate REAL DEFAULT 3.0,
    viral_score INTEGER DEFAULT 0,
    estimated_revenue INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS content (
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
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    followers INTEGER DEFAULT 0,
    total_revenue INTEGER DEFAULT 0,
    post_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active'
  )`,
  `CREATE TABLE IF NOT EXISTS revenue_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id),
    content_id INTEGER REFERENCES content(id),
    amount INTEGER NOT NULL,
    commission_type TEXT DEFAULT 'coupang_partners',
    logged_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS automation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT NOT NULL,
    status TEXT DEFAULT 'running',
    products_found INTEGER DEFAULT 0,
    content_generated INTEGER DEFAULT 0,
    posts_published INTEGER DEFAULT 0,
    error TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER REFERENCES content(id),
    platform TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    youtube_video_id TEXT,
    published_at TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS click_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER REFERENCES content(id),
    product_id INTEGER REFERENCES products(id),
    affiliate_url TEXT,
    ip_hash TEXT,
    user_agent TEXT,
    clicked_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS agent_states (
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
  )`,
  `CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name TEXT NOT NULL,
    task_type TEXT NOT NULL,
    task_data TEXT,
    status TEXT DEFAULT 'pending',
    result TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS evolution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle INTEGER NOT NULL DEFAULT 1,
    insights TEXT,
    strategy_changes TEXT,
    top_product TEXT,
    top_platform TEXT,
    top_hook TEXT,
    performance_delta INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS revenue_accounts (
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
  )`,
  `INSERT OR IGNORE INTO agent_states (agent_name, status) VALUES ('trend_agent', 'idle')`,
  `INSERT OR IGNORE INTO agent_states (agent_name, status) VALUES ('content_agent', 'idle')`,
  `INSERT OR IGNORE INTO agent_states (agent_name, status) VALUES ('publish_agent', 'idle')`,
  `INSERT OR IGNORE INTO agent_states (agent_name, status) VALUES ('revenue_agent', 'idle')`,
  `INSERT OR IGNORE INTO agent_states (agent_name, status) VALUES ('evolution_agent', 'idle')`,
]

const MIGRATIONS = [
  `ALTER TABLE content ADD COLUMN video_url TEXT`,
  `ALTER TABLE content ADD COLUMN target_market TEXT DEFAULT 'KR'`,
  `ALTER TABLE content ADD COLUMN language TEXT DEFAULT 'ko'`,
  `ALTER TABLE content ADD COLUMN updated_at TEXT`,
  `ALTER TABLE products ADD COLUMN target_market TEXT DEFAULT 'KR'`,
  `ALTER TABLE products ADD COLUMN affiliate_program TEXT DEFAULT 'coupang'`,
  `ALTER TABLE scheduled_posts ADD COLUMN tistory_post_id TEXT`,
  `ALTER TABLE scheduled_posts ADD COLUMN blog_url TEXT`,
  `INSERT OR IGNORE INTO agent_states (agent_name, status) VALUES ('click_agent', 'idle')`,
  `INSERT OR IGNORE INTO agent_states (agent_name, status) VALUES ('seo_agent', 'idle')`,
  `INSERT OR IGNORE INTO agent_states (agent_name, status) VALUES ('video_agent', 'idle')`,
  `ALTER TABLE scheduled_posts ADD COLUMN retry_count INTEGER DEFAULT 0`,
  `ALTER TABLE content ADD COLUMN ab_group TEXT DEFAULT 'A'`,
  `ALTER TABLE content ADD COLUMN click_count INTEGER DEFAULT 0`,
  `ALTER TABLE content ADD COLUMN render_id TEXT`,
  `ALTER TABLE content ADD COLUMN compliance_status TEXT DEFAULT 'pending'`,
  `ALTER TABLE content ADD COLUMN ai_disclosed INTEGER DEFAULT 1`,
  `ALTER TABLE content ADD COLUMN affiliate_disclosed INTEGER DEFAULT 1`,
  `ALTER TABLE content ADD COLUMN risk_level TEXT DEFAULT 'low'`,
]

async function initSchema(client: Client): Promise<void> {
  await client.batch(SCHEMA_STMTS.map(sql => ({ sql, args: [] })), 'write')

  for (const sql of MIGRATIONS) {
    try { await client.execute(sql) } catch { /* column/row already exists */ }
  }

  const countRow = await client.execute('SELECT COUNT(*) as c FROM accounts')
  const count = Number((countRow.rows[0] as unknown as { c: number }).c)
  if (count === 0) await seedAccounts(client)
}

async function seedAccounts(client: Client): Promise<void> {
  const distribution: Record<string, number> = {
    YouTube: 10, Instagram: 8, TikTok: 6, Facebook: 3, Threads: 2, Naver: 1,
  }
  const inserts: { sql: string; args: DbArgs }[] = []
  for (const [platform, n] of Object.entries(distribution)) {
    const prefix = platform === 'YouTube' ? 'yt'
      : platform === 'Instagram' ? 'ig'
      : platform.slice(0, 2).toLowerCase()
    for (let i = 1; i <= n; i++) {
      inserts.push({
        sql: 'INSERT INTO accounts (platform, username, followers, total_revenue, post_count, status) VALUES (?, ?, ?, ?, ?, ?)',
        args: [platform, `shorts_${prefix}_${i}`, 0, 0, 0, 'active'],
      })
    }
  }
  await client.batch(inserts, 'write')
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
  created_at: string
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
