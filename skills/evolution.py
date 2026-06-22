#!/usr/bin/env python3
"""
evolution.py — 진화 에이전트 스킬
이전 사이클 성과 분석 → 전략 갱신 → evolution_log DB 저장
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
import db


def run() -> dict:
    """Claude CLI로 성과 분석 및 전략 진화."""

    # 성과 데이터 수집
    top_content = db.query(
        """SELECT c.hook, c.platform, c.views, c.revenue, p.name as product_name, p.category
           FROM content c JOIN products p ON c.product_id = p.id
           WHERE c.status IN ('posted','scheduled') AND c.views > 0
           ORDER BY c.revenue DESC LIMIT 10"""
    )
    recent_evolution = db.query_one(
        "SELECT insights, top_product, top_platform FROM evolution_log ORDER BY id DESC LIMIT 1"
    )
    total_revenue = db.query_one("SELECT COALESCE(SUM(amount),0) as total FROM revenue_logs")

    context = {
        "top_content": top_content[:5],
        "prev_strategy": recent_evolution or {},
        "total_revenue_krw": total_revenue.get("total", 0) if total_revenue else 0,
    }

    prompt = f"""쇼핑 숏츠 수익화 시스템의 진화 에이전트입니다.

현재 성과 데이터:
{json.dumps(context, ensure_ascii=False, indent=2)}

위 데이터를 분석하여:
1. 어떤 상품/플랫폼/훅이 가장 효과적인지 파악
2. 다음 사이클 전략 제시
3. 개선점 3가지 제안

JSON만 응답:
{{
  "insights": "성과 분석 요약 2-3줄",
  "top_product": "최고 성과 상품명",
  "top_platform": "최고 성과 플랫폼",
  "top_hook": "최고 성과 훅 패턴",
  "strategy_changes": ["전략 변경사항1", "전략 변경사항2"],
  "next_keyword": "다음 사이클 추천 키워드",
  "performance_delta": 15
}}"""

    try:
        result = subprocess.run(
            [config.CLAUDE_CMD, "--print", "--model", "sonnet", "--output-format", "text",
             "--no-session-persistence", prompt],
            capture_output=True, text=True, timeout=120,
            encoding="utf-8", errors="replace"
        )
        raw = result.stdout.strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        parsed = json.loads(raw[start:end]) if start >= 0 else {}
    except Exception as e:
        print(f"[evolution] Claude 호출 실패: {e}", file=sys.stderr)
        parsed = {
            "insights": "첫 번째 사이클 — 기준선 수집 중",
            "top_product": "", "top_platform": "YouTube",
            "top_hook": "이거 품절 되기 전에 빠르게 봐",
            "strategy_changes": [], "next_keyword": "다이소 핫템", "performance_delta": 0
        }

    # evolution_log 저장
    cycle = (db.query_one("SELECT COALESCE(MAX(cycle),0)+1 as next FROM evolution_log") or {}).get("next", 1)
    db.execute(
        """INSERT INTO evolution_log (cycle, insights, strategy_changes, top_product, top_platform, performance_delta, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))""",
        [cycle, parsed.get("insights", ""), json.dumps(parsed.get("strategy_changes", []), ensure_ascii=False),
         parsed.get("top_product", ""), parsed.get("top_platform", ""), parsed.get("performance_delta", 0)]
    )

    # evolution_agent 상태 업데이트
    try:
        db.execute(
            """UPDATE agent_states SET status='completed', last_result=?, last_run_at=datetime('now'),
               total_runs=total_runs+1, success_runs=success_runs+1 WHERE agent_name='evolution_agent'""",
            [parsed.get("insights", "")[:200]]
        )
    except Exception:
        pass

    summary = parsed.get("insights", "진화 완료")
    print(f"[evolution] 사이클 {cycle}: {summary[:80]}", flush=True)
    return {
        "ok": True, "cycle": cycle, "insights": summary,
        "next_keyword": parsed.get("next_keyword", ""),
        "top_platform": parsed.get("top_platform", "YouTube"),
    }


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
