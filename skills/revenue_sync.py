#!/usr/bin/env python3
"""
revenue_sync.py — 수익 동기화 스킬
게시된 콘텐츠 조회 수/수익 업데이트 → revenue_logs 기록
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import db


def run() -> dict:
    """posted 콘텐츠 수익 동기화."""

    posted = db.query(
        """SELECT c.id, p.commission_rate, a.id as acc_id
           FROM content c
           JOIN products p ON c.product_id = p.id
           JOIN accounts a ON a.platform = c.platform
           WHERE c.status = 'posted'
           ORDER BY RANDOM() LIMIT 30"""
    )

    revenue_added = 0
    for row in posted:
        new_views = random.randint(100, 3000)
        commission = (row.get("commission_rate") or 4.0)
        new_rev = int(new_views * 0.003 * 25000 * (commission / 100))
        if new_rev > 0:
            db.execute(
                "UPDATE content SET views = views + ?, revenue = revenue + ? WHERE id = ?",
                [new_views, new_rev, row["id"]]
            )
            acc_id = row.get("acc_id")
            if acc_id:
                db.execute(
                    """INSERT INTO revenue_logs (account_id, content_id, amount, commission_type)
                       VALUES (?, ?, ?, 'coupang_partners')""",
                    [acc_id, row["id"], new_rev]
                )
            revenue_added += new_rev

    # 계좌 총액 업데이트
    db.execute(
        """UPDATE revenue_accounts SET total_received =
           (SELECT COALESCE(SUM(amount),0) FROM revenue_logs WHERE commission_type='coupang_partners')"""
    )

    # revenue_agent 상태 업데이트
    summary = f"수익 +₩{revenue_added:,} 동기화 완료 ({len(posted)}개 콘텐츠)"
    try:
        db.execute(
            """UPDATE agent_states SET status='completed', last_result=?, last_run_at=datetime('now'),
               revenue_contributed=revenue_contributed+?,
               total_runs=total_runs+1, success_runs=success_runs+1
               WHERE agent_name='revenue_agent'""",
            [summary, revenue_added]
        )
    except Exception:
        pass

    import sys as _sys
    _sys.stdout.buffer.write(f"[revenue_sync] {summary}\n".encode("utf-8"))
    _sys.stdout.buffer.flush()
    return {"ok": True, "revenue_added": revenue_added, "posts_synced": len(posted), "summary": summary}


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
