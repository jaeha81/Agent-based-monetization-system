import { createClient, type Client } from '@libsql/client'
import path from 'path'
import fs from 'fs'

const isVercel = !!process.env.VERCEL
const TURSO_URL = process.env.TURSO_DATABASE_URL
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN
export const SCHEMA_VERSION = 20260728

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

const WORKFLOW_JOBS_SCHEMA = `CREATE TABLE IF NOT EXISTS workflow_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_name TEXT NOT NULL,
  node_type TEXT NOT NULL,
  trigger_type TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'queued',
  input_data TEXT,
  output_data TEXT,
  product_id INTEGER,
  content_id INTEGER,
  render_id TEXT,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
)`


const BRAIN_PROBLEMS_SCHEMA = `CREATE TABLE IF NOT EXISTS brain_problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  recommendation TEXT,
  resolved INTEGER DEFAULT 0,
  detected_at TEXT DEFAULT (datetime('now'))
)`

const MARKET_TRENDS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS market_trend_videos (source TEXT NOT NULL, region TEXT NOT NULL, external_id TEXT NOT NULL, title TEXT NOT NULL, view_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0, shopping_relevant INTEGER DEFAULT 0, collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(source, region, external_id))`,
  `CREATE TABLE IF NOT EXISTS market_trend_keywords (id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT NOT NULL, region TEXT NOT NULL, source TEXT NOT NULL, signal_count INTEGER DEFAULT 0, total_views INTEGER DEFAULT 0, score REAL DEFAULT 0, collected_at TEXT DEFAULT (datetime('now')))`
]

const MUSIC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS music_tracks (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, url TEXT NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL, commercial_use INTEGER DEFAULT 0, active INTEGER DEFAULT 1, uses INTEGER DEFAULT 0, avg_retention REAL DEFAULT 0, avg_click_rate REAL DEFAULT 0, performance_score REAL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS music_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_key TEXT NOT NULL, music_track_id TEXT NOT NULL REFERENCES music_tracks(id), assigned_at TEXT DEFAULT (datetime('now')))`,
  `INSERT OR IGNORE INTO music_tracks (id,title,artist,url,license,attribution,commercial_use) VALUES ('americana','Americana','Kevin MacLeod','https://incompetech.com/music/royalty-free/mp3-royaltyfree/Americana.mp3','CC BY 3.0','Americana — Kevin MacLeod (incompetech.com), CC BY 3.0',1)`,
  `INSERT OR IGNORE INTO music_tracks (id,title,artist,url,license,attribution,commercial_use) VALUES ('beach-party','Beach Party','Kevin MacLeod','https://incompetech.com/music/royalty-free/mp3-royaltyfree/Beach%20Party.mp3','CC BY 3.0','Beach Party — Kevin MacLeod (incompetech.com), CC BY 3.0',1)`,
  `INSERT OR IGNORE INTO music_tracks (id,title,artist,url,license,attribution,commercial_use) VALUES ('bright-wish','Bright Wish','Kevin MacLeod','https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bright%20Wish.mp3','CC BY 3.0','Bright Wish — Kevin MacLeod (incompetech.com), CC BY 3.0',1)`,
  `INSERT OR IGNORE INTO music_tracks (id,title,artist,url,license,attribution,commercial_use) VALUES ('cool-vibes','Cool Vibes','Kevin MacLeod','https://incompetech.com/music/royalty-free/mp3-royaltyfree/Cool%20Vibes.mp3','CC BY 3.0','Cool Vibes — Kevin MacLeod (incompetech.com), CC BY 3.0',1)`
]

const PROFIT_SCHEMA = `CREATE TABLE IF NOT EXISTS content_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, content_id INTEGER NOT NULL REFERENCES content(id),
  cost_type TEXT NOT NULL, amount INTEGER NOT NULL, metadata TEXT, created_at TEXT DEFAULT (datetime('now'))
)`
const WEBHOOK_EVENTS_SCHEMA = `CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL, event_key TEXT NOT NULL, received_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(provider, event_key)
)`
const MIGRATIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY, sql_hash TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now'))
)`

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
  `ALTER TABLE products ADD COLUMN price INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN image_url TEXT`,
  `ALTER TABLE content ADD COLUMN image_url TEXT`,
  `ALTER TABLE content ADD COLUMN render_status TEXT DEFAULT 'idle'`,
  `ALTER TABLE products ADD COLUMN approved INTEGER DEFAULT 1`,
  `ALTER TABLE scheduled_posts ADD COLUMN qa_status TEXT DEFAULT 'pending'`,
  `ALTER TABLE scheduled_posts ADD COLUMN visibility TEXT DEFAULT 'private'`,
  `ALTER TABLE scheduled_posts ADD COLUMN qa_score INTEGER DEFAULT 0`,
  `ALTER TABLE scheduled_posts ADD COLUMN qa_details TEXT`,
  `ALTER TABLE content ADD COLUMN likes INTEGER DEFAULT 0`,
  `ALTER TABLE content ADD COLUMN comments INTEGER DEFAULT 0`,
  `ALTER TABLE content ADD COLUMN avg_view_duration REAL DEFAULT 0`,
  `ALTER TABLE content ADD COLUMN avg_view_percentage REAL DEFAULT 0`,
  `ALTER TABLE content ADD COLUMN performance_score REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN performance_score REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN total_views INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN total_clicks INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN avg_retention REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN last_performance_sync_at TEXT`,
  `ALTER TABLE content ADD COLUMN music_track_id TEXT`,
  `CREATE TABLE IF NOT EXISTS manual_revenue_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    source TEXT NOT NULL,
    amount INTEGER NOT NULL,
    period TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `ALTER TABLE manual_revenue_entries ADD COLUMN product_id INTEGER`,
  `ALTER TABLE manual_revenue_entries ADD COLUMN content_id INTEGER`,
  `ALTER TABLE products ADD COLUMN actual_revenue INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN total_cost INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN net_profit INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN profit_score REAL DEFAULT 0`,
  `ALTER TABLE content ADD COLUMN render_provider TEXT`,
  `ALTER TABLE content ADD COLUMN video_width INTEGER`,
  `ALTER TABLE content ADD COLUMN video_height INTEGER`,
  `ALTER TABLE content ADD COLUMN video_duration_seconds REAL`,
  `ALTER TABLE products ADD COLUMN selection_score REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN decision_confidence REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN decision_action TEXT DEFAULT 'learn'`,
  `ALTER TABLE products ADD COLUMN decision_reason TEXT`,
  `ALTER TABLE products ADD COLUMN decision_updated_at TEXT`,
  `ALTER TABLE products ADD COLUMN market_trend_score REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN market_trend_reason TEXT`,
  `ALTER TABLE products ADD COLUMN market_trend_updated_at TEXT`,
  `ALTER TABLE manual_revenue_entries ADD COLUMN external_id TEXT`,
  `ALTER TABLE manual_revenue_entries ADD COLUMN event_type TEXT DEFAULT 'commission'`,
  `ALTER TABLE manual_revenue_entries ADD COLUMN currency TEXT DEFAULT 'KRW'`,
  `ALTER TABLE manual_revenue_entries ADD COLUMN occurred_at TEXT`,
  `ALTER TABLE manual_revenue_entries ADD COLUMN settlement_status TEXT DEFAULT 'settled'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_revenue_external
   ON manual_revenue_entries(platform, source, external_id, event_type)`,
  `ALTER TABLE music_assignments ADD COLUMN content_id INTEGER REFERENCES content(id)`,
  `ALTER TABLE music_assignments ADD COLUMN explore INTEGER DEFAULT 0`,
  `ALTER TABLE music_assignments ADD COLUMN propensity REAL DEFAULT 1`,
  `ALTER TABLE music_assignments ADD COLUMN policy_version TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_music_assignment_content ON music_assignments(content_id)`,
  `ALTER TABLE content ADD COLUMN metrics_source TEXT`,
  `ALTER TABLE content ADD COLUMN metrics_window_start TEXT`,
  `ALTER TABLE content ADD COLUMN metrics_window_end TEXT`,
  `CREATE VIEW IF NOT EXISTS revenue_events AS
   SELECT id, NULL AS account_id, content_id, product_id, platform, amount,
          event_type AS commission_type, COALESCE(occurred_at, created_at) AS logged_at
   FROM manual_revenue_entries WHERE COALESCE(settlement_status, 'settled') = 'settled'`,
  `DELETE FROM content_costs WHERE metadata IS NOT NULL AND id NOT IN (
     SELECT MIN(id) FROM content_costs WHERE metadata IS NOT NULL GROUP BY content_id, cost_type, metadata
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_content_cost_event
   ON content_costs(content_id, cost_type, metadata)`,
  `ALTER TABLE music_tracks ADD COLUMN observed_videos INTEGER DEFAULT 0`,
  `ALTER TABLE music_tracks ADD COLUMN observed_views INTEGER DEFAULT 0`,
  `ALTER TABLE music_tracks ADD COLUMN evidence_confidence REAL DEFAULT 0`,
  `ALTER TABLE content ADD COLUMN last_analytics_success_at TEXT`,
  `ALTER TABLE content ADD COLUMN engaged_views INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN total_engaged_views INTEGER DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS youtube_metric_snapshots (
     content_id INTEGER NOT NULL REFERENCES content(id), snapshot_date TEXT NOT NULL,
     window_start TEXT NOT NULL, window_end TEXT NOT NULL, views INTEGER DEFAULT 0,
     engaged_views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
     avg_view_duration REAL DEFAULT 0, avg_view_percentage REAL DEFAULT 0,
     collected_at TEXT DEFAULT (datetime('now')),
     PRIMARY KEY(content_id, snapshot_date, window_start)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_click_dedupe ON click_logs(content_id, ip_hash, clicked_at)`,
  `ALTER TABLE products ADD COLUMN revenue_data_complete_through TEXT`,
  `ALTER TABLE market_trend_videos ADD COLUMN view_velocity REAL DEFAULT 0`,
  `ALTER TABLE market_trend_keywords ADD COLUMN growth_score REAL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS market_trend_snapshots (
     id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, region TEXT NOT NULL,
     external_id TEXT NOT NULL, view_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0,
     collected_at TEXT DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_market_snapshot_lookup
   ON market_trend_snapshots(source, region, external_id, collected_at)`,
  `CREATE TABLE IF NOT EXISTS experiment_assignments (
     id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_key TEXT NOT NULL,
     entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, arm TEXT NOT NULL,
     policy_version TEXT NOT NULL, propensity REAL NOT NULL, context_json TEXT,
     assigned_at TEXT DEFAULT (datetime('now')), outcome_window_end TEXT,
     UNIQUE(assignment_key, entity_type, entity_id)
   )`,
  `DROP VIEW IF EXISTS revenue_events`,
  `CREATE VIEW revenue_events AS
   SELECT m.id, NULL AS account_id, m.content_id,
          COALESCE(m.product_id, (SELECT c.product_id FROM content c WHERE c.id = m.content_id)) AS product_id,
          m.platform, m.amount, m.event_type AS commission_type,
          COALESCE(m.occurred_at, m.created_at) AS logged_at
   FROM manual_revenue_entries m WHERE COALESCE(m.settlement_status, 'settled') = 'settled'`,
  `ALTER TABLE content ADD COLUMN last_retention_success_at TEXT`,
  `CREATE TABLE IF NOT EXISTS youtube_retention_points (
     content_id INTEGER NOT NULL REFERENCES content(id), window_start TEXT NOT NULL,
     window_end TEXT NOT NULL, elapsed_ratio REAL NOT NULL, audience_watch_ratio REAL DEFAULT 0,
     relative_retention REAL DEFAULT 0, collected_at TEXT DEFAULT (datetime('now')),
     PRIMARY KEY(content_id, window_start, elapsed_ratio)
   )`,
]

async function initSchema(client: Client): Promise<void> {
  await client.batch(SCHEMA_STMTS.map(sql => ({ sql, args: [] })), 'write')
  await client.execute(WORKFLOW_JOBS_SCHEMA)
  await client.execute(BRAIN_PROBLEMS_SCHEMA)
  for (const sql of MARKET_TRENDS_SCHEMA) await client.execute(sql)
  for (const sql of MUSIC_SCHEMA) await client.execute(sql)
  await client.execute(PROFIT_SCHEMA)
  await client.execute(WEBHOOK_EVENTS_SCHEMA)
  await client.execute(MIGRATIONS_SCHEMA)

  for (let index = 0; index < MIGRATIONS.length; index++) await applyMigration(client, index + 1, MIGRATIONS[index])
  await client.execute({
    sql: "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('schema_version', ?, datetime('now'))",
    args: [String(SCHEMA_VERSION)],
  })

  const countRow = await client.execute('SELECT COUNT(*) as c FROM accounts')
  const count = Number((countRow.rows[0] as unknown as { c: number }).c)
  if (count === 0) await seedAccounts(client)
}

async function applyMigration(client: Client, id: number, sql: string): Promise<void> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql))
  const sqlHash = Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
  const applied = await client.execute({ sql: 'SELECT id, sql_hash FROM schema_migrations WHERE id = ?', args: [id] })
  if (applied.rows.length > 0) {
    if (String(applied.rows[0].sql_hash) !== sqlHash) throw new Error(`DB migration ${id} checksum mismatch`)
    return
  }
  try {
    await client.execute(sql)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/duplicate column name|already exists/i.test(message)) {
      throw new Error(`DB migration ${id} failed: ${message}`)
    }
  }
  await client.execute({ sql: 'INSERT INTO schema_migrations (id, sql_hash) VALUES (?, ?)', args: [id, sqlHash] })
}

export async function getDatabaseDiagnostics(): Promise<{ schemaVersion: number; expectedVersion: number; migrationCount: number; latencyMs: number }> {
  const started = Date.now()
  const client = await ensureInit()
  const [version, migrations] = await Promise.all([
    client.execute("SELECT value FROM settings WHERE key = 'schema_version'"),
    client.execute('SELECT COUNT(*) AS count FROM schema_migrations'),
  ])
  return {
    schemaVersion: Number(version.rows[0]?.value || 0),
    expectedVersion: SCHEMA_VERSION,
    migrationCount: Number(migrations.rows[0]?.count || 0),
    latencyMs: Date.now() - started,
  }
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
  qa_status: string
  visibility: string
  created_at: string
}
