import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'shorts.db')

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
      posted_at TEXT
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
  `)

  const count = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c
  if (count === 0) {
    seedData(db)
  }
}

function seedData(db: Database.Database) {
  const products = [
    { name: '다이소 시냅스 클리어 보드마카', category: '다이소', commission_rate: 3.0, viral_score: 87, estimated_revenue: 4500000 },
    { name: '일본 제브라 샤프 0.3mm 델가도', category: '다이소', commission_rate: 3.0, viral_score: 82, estimated_revenue: 3200000 },
    { name: '나이키 에어포스 1 화이트', category: '패션', commission_rate: 2.0, viral_score: 91, estimated_revenue: 8500000 },
    { name: 'MAC 블러셔 팔레트 코럴 라이트', category: '뷰티', commission_rate: 5.0, viral_score: 94, estimated_revenue: 12000000 },
    { name: '티파니앤코 향수 체리블라썸', category: '뷰티', commission_rate: 5.0, viral_score: 96, estimated_revenue: 18000000 },
    { name: '닌텐도 스위치 OLED 화이트', category: '전자기기', commission_rate: 1.5, viral_score: 88, estimated_revenue: 6000000 },
    { name: '마리오 카트 8 딜럭스', category: '전자기기', commission_rate: 1.5, viral_score: 79, estimated_revenue: 3500000 },
    { name: '아이코닉 쭈물럭 센서리 토이', category: '유아', commission_rate: 7.0, viral_score: 92, estimated_revenue: 15000000 },
    { name: '핑크퐁 뽀로로 목욕장난감 세트', category: '유아', commission_rate: 7.0, viral_score: 85, estimated_revenue: 7500000 },
    { name: '솔로 테니스 리바운더', category: '스포츠', commission_rate: 6.0, viral_score: 90, estimated_revenue: 11000000 },
    { name: '듀얼 그립 스쿼트 기구', category: '스포츠', commission_rate: 6.0, viral_score: 78, estimated_revenue: 4000000 },
    { name: '윈터 맥 립스틱 맑은 베이지', category: '뷰티', commission_rate: 5.0, viral_score: 93, estimated_revenue: 14000000 },
    { name: '다이소 중성펜 10개입', category: '다이소', commission_rate: 3.0, viral_score: 75, estimated_revenue: 2800000 },
    { name: '쿠팡 냉장고 도어록 바람막이', category: '다이소', commission_rate: 3.0, viral_score: 83, estimated_revenue: 5000000 },
    { name: '제니 브루노마스 노트 포케이크 쿠키 슬리퍼', category: '패션', commission_rate: 2.0, viral_score: 95, estimated_revenue: 20000000 },
    { name: '강민경 추천 에스트라 토너패드', category: '뷰티', commission_rate: 5.0, viral_score: 89, estimated_revenue: 9500000 },
    { name: 'PS5 듀얼센스 엣지 무선 컨트롤러', category: '전자기기', commission_rate: 1.5, viral_score: 84, estimated_revenue: 7000000 },
    { name: '에어팟 프로 2세대 USB-C', category: '전자기기', commission_rate: 1.5, viral_score: 88, estimated_revenue: 8000000 },
    { name: '유아 러닝맘 안전 무릎보호대', category: '유아', commission_rate: 7.0, viral_score: 80, estimated_revenue: 4500000 },
    { name: '다이소 공간 수납 진공 압축백', category: '다이소', commission_rate: 3.0, viral_score: 86, estimated_revenue: 6200000 },
  ]

  const insertProduct = db.prepare(
    'INSERT INTO products (name, category, commission_rate, viral_score, estimated_revenue) VALUES (?, ?, ?, ?, ?)'
  )
  products.forEach(p => insertProduct.run(p.name, p.category, p.commission_rate, p.viral_score, p.estimated_revenue))

  const platforms = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver']
  const accountDistribution: Record<string, number> = {
    YouTube: 10, Instagram: 8, TikTok: 6, Facebook: 3, Threads: 2, Naver: 1
  }

  const insertAccount = db.prepare(
    'INSERT INTO accounts (platform, username, followers, total_revenue, post_count, status) VALUES (?, ?, ?, ?, ?, ?)'
  )

  let accountId = 1
  platforms.forEach(platform => {
    const count = accountDistribution[platform]
    for (let i = 1; i <= count; i++) {
      const prefix = platform === 'YouTube' ? 'YT' : platform === 'Instagram' ? 'IG' : platform.slice(0, 2).toUpperCase()
      const followers = Math.floor(Math.random() * 50000) + 1000
      const revenue = Math.floor(Math.random() * 5000000) + 100000
      const posts = Math.floor(Math.random() * 200) + 10
      const status = Math.random() > 0.1 ? 'active' : 'dormant'
      insertAccount.run(platform, `shorts_${prefix.toLowerCase()}_${i}`, followers, revenue, posts, status)
      void accountId; accountId++
    }
  })

  const hooks = [
    '이거 다이소에서 파는 거 맞아?? 1500원인데 퀄이...',
    '30초도 안 되는 영상으로 1천만원 번 제품',
    '나이키가 이 가격이라고?? 링크 댓글에',
    '연예인들이 다 사는 그 제품 발견했음',
    '이거 품절 되기 전에 빠르게',
    '다이어트 하는 분들 이거 모르면 손해',
    '남자들 이거 알아? 진짜 신기함',
    '엄마들 필수템 발견 ㅠㅠ 댓글에 링크',
  ]

  const scripts: Record<string, string> = {
    YouTube: '영상 설명에 구매 링크 달아놨어요! 쿠팡 파트너스 통해서 살 수 있어요.',
    Instagram: '인스타 프로필 링크에서 구매 가능해요 👆 DM으로 문의도 환영!',
    TikTok: '링크 바이오에 있어요! #쇼핑추천 #핫템 #다이소',
    Facebook: '댓글에 링크 달아놨어요. 관심있으신 분들 얼른 확인하세요!',
    Threads: '프로필 링크로 이동하시면 구매 페이지로 연결됩니다.',
    Naver: '블로그 글 링크 확인하세요. 최저가 쿠팡 파트너스 링크 있어요.'
  }

  const insertContent = db.prepare(
    'INSERT INTO content (product_id, platform, hook, script, image_prompt, status, views, revenue, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )

  const statuses = ['posted', 'posted', 'posted', 'scheduled', 'draft']
  for (let i = 1; i <= 20; i++) {
    platforms.forEach((platform) => {
      const hook = hooks[Math.floor(Math.random() * hooks.length)]
      const views = Math.floor(Math.random() * 12000000)
      const revenue = Math.floor(views * 0.001 * (0.3 + Math.random() * 0.7))
      const status = statuses[Math.floor(Math.random() * statuses.length)]
      const daysAgo = Math.floor(Math.random() * 90)
      const date = new Date()
      date.setDate(date.getDate() - daysAgo)
      const postedAt = status === 'posted' ? date.toISOString() : null

      insertContent.run(
        i,
        platform,
        hook,
        scripts[platform],
        `Professional product photo of ${platform} style, white background, Korean shopping app aesthetic, high quality`,
        status,
        status === 'posted' ? views : 0,
        status === 'posted' ? revenue : 0,
        postedAt
      )
    })
  }

  const insertRevenue = db.prepare(
    'INSERT INTO revenue_logs (account_id, content_id, amount, commission_type, logged_at) VALUES (?, ?, ?, ?, ?)'
  )

  for (let i = 0; i < 200; i++) {
    const accId = Math.floor(Math.random() * 30) + 1
    const cntId = Math.floor(Math.random() * 120) + 1
    const amount = Math.floor(Math.random() * 500000) + 10000
    const types = ['coupang_partners', 'coupang_partners', 'youtube_ads', 'coupang_partners']
    const type = types[Math.floor(Math.random() * types.length)]
    const daysAgo = Math.floor(Math.random() * 90)
    const date = new Date()
    date.setDate(date.getDate() - daysAgo)
    insertRevenue.run(accId, cntId, amount, type, date.toISOString())
  }
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
