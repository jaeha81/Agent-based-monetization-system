import { execute } from '@/lib/db'

const COST_DEFAULTS: Record<string, number> = {
  veo_render: 700,
  shotstack_render: 250,
  image_generation: 60,
  tts: 20,
  llm_content: 15,
}

export async function recordContentCost(contentId: number, costType: keyof typeof COST_DEFAULTS, metadata?: string) {
  const envKey = `COST_${costType.toUpperCase()}_KRW`
  const amount = Math.max(0, Number(process.env[envKey] || COST_DEFAULTS[costType]))
  await execute(
    `INSERT OR IGNORE INTO content_costs (content_id, cost_type, amount, metadata) VALUES (?, ?, ?, ?)`,
    [contentId, costType, amount, metadata || null]
  )
  return amount
}

export async function refreshProductProfitability() {
  await execute(`
    UPDATE products SET
      actual_revenue = COALESCE((SELECT SUM(m.amount) FROM manual_revenue_entries m
        WHERE COALESCE(m.product_id, (SELECT c.product_id FROM content c WHERE c.id = m.content_id)) = products.id
          AND COALESCE(m.settlement_status, 'settled') = 'settled'), 0),
      total_cost = COALESCE((SELECT SUM(cc.amount) FROM content_costs cc JOIN content c ON c.id = cc.content_id WHERE c.product_id = products.id), 0),
      net_profit = COALESCE((SELECT SUM(m.amount) FROM manual_revenue_entries m
        WHERE COALESCE(m.product_id, (SELECT c.product_id FROM content c WHERE c.id = m.content_id)) = products.id
          AND COALESCE(m.settlement_status, 'settled') = 'settled'), 0)
        - COALESCE((SELECT SUM(cc.amount) FROM content_costs cc JOIN content c ON c.id = cc.content_id WHERE c.product_id = products.id), 0),
      profit_score = CASE
        WHEN COALESCE((SELECT SUM(cc.amount) FROM content_costs cc JOIN content c ON c.id = cc.content_id WHERE c.product_id = products.id), 0) <= 0 THEN 0
        ELSE MAX(-100, MIN(100, (
          COALESCE((SELECT SUM(m.amount) FROM manual_revenue_entries m
            WHERE COALESCE(m.product_id, (SELECT c.product_id FROM content c WHERE c.id = m.content_id)) = products.id
              AND COALESCE(m.settlement_status, 'settled') = 'settled'), 0)
          - COALESCE((SELECT SUM(cc.amount) FROM content_costs cc JOIN content c ON c.id = cc.content_id WHERE c.product_id = products.id), 0)
        ) * 100.0 / COALESCE((SELECT SUM(cc.amount) FROM content_costs cc JOIN content c ON c.id = cc.content_id WHERE c.product_id = products.id), 1)))
      END
  `)
}
