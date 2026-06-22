#!/usr/bin/env python3
"""
product_discovery.py — 쇼핑 상품 발굴 스킬
Gemini API로 트렌드 상품 분석 → Turso DB 저장
"""
import json
import time
import urllib.request
import urllib.error
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
import db

# 쿠팡 큐레이션 풀 (API 없이 운영, 수수료율 기준)
PRODUCT_POOL = [
    {"name": "다이소 LED 전구 세트", "category": "생활용품", "commissionRate": 4.0,
     "url": f"https://link.coupang.com/a/{config.COUPANG_CHANNEL_ID}?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3DLED%2B%EC%A0%84%EA%B5%AC"},
    {"name": "솔로 테니스 리바운더", "category": "스포츠", "commissionRate": 6.0,
     "url": f"https://link.coupang.com/a/{config.COUPANG_CHANNEL_ID}?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3D%EC%86%94%EB%A1%9C%2B%ED%85%8C%EB%8B%88%EC%8A%A4"},
    {"name": "아기 실리콘 이유식 도구 세트", "category": "유아", "commissionRate": 7.0,
     "url": f"https://link.coupang.com/a/{config.COUPANG_CHANNEL_ID}?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3D%EC%9D%B4%EC%9C%A0%EC%8B%9D+%EB%8F%84%EA%B5%AC"},
    {"name": "피부 수분 앰플 세트", "category": "뷰티", "commissionRate": 5.0,
     "url": f"https://link.coupang.com/a/{config.COUPANG_CHANNEL_ID}?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3D%EC%95%B0%ED%94%8C"},
    {"name": "공기청정기 필터 교체팩", "category": "생활용품", "commissionRate": 4.0,
     "url": f"https://link.coupang.com/a/{config.COUPANG_CHANNEL_ID}?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3D%EA%B3%B5%EA%B8%B0%EC%B2%AD%EC%A0%95%EA%B8%B0+%ED%95%84%ED%84%B0"},
    {"name": "접이식 요가매트 가방 포함", "category": "스포츠", "commissionRate": 6.0,
     "url": f"https://link.coupang.com/a/{config.COUPANG_CHANNEL_ID}?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3D%EC%9A%94%EA%B0%80%EB%A7%A4%ED%8A%B8"},
    {"name": "어린이 전동 칫솔 세트", "category": "유아", "commissionRate": 7.0,
     "url": f"https://link.coupang.com/a/{config.COUPANG_CHANNEL_ID}?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3D%EC%96%B4%EB%A6%B0%EC%9D%B4+%EC%A0%84%EB%8F%99+%EC%B9%AB%EC%86%94"},
    {"name": "클렌징 폼 대용량 기획세트", "category": "뷰티", "commissionRate": 5.0,
     "url": f"https://link.coupang.com/a/{config.COUPANG_CHANNEL_ID}?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3D%ED%81%B4%EB%A0%8C%EC%A7%95+%ED%8F%BC"},
]


def _call_ai(prompt: str) -> str:
    """Claude Code CLI (구독형) → Gemini fallback → 텍스트 반환."""
    import subprocess

    # 1순위: Claude Code CLI (구독형 — API 크레딧 불필요, stdin으로 전달)
    try:
        result = subprocess.run(
            [config.CLAUDE_CMD, "--print"],
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        raise RuntimeError(f"Claude CLI 실패 (returncode={result.returncode}): {result.stderr[:200]}")
    except Exception as e:
        print(f"[product_discovery] Claude CLI 실패: {e} — Gemini로 폴백", file=sys.stderr)

    # 2순위: Gemini 2.0 Flash (fallback)
    if config.GEMINI_API_KEY:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-2.0-flash:generateContent?key={config.GEMINI_API_KEY}"
        )
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1024},
        }).encode()
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    raw = resp.read()
                    if not raw:
                        raise ValueError("빈 응답")
                    data = json.loads(raw)
                return data["candidates"][0]["content"]["parts"][0]["text"]
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt == 0:
                    time.sleep(35)
                    continue
                raise
            except (ValueError, KeyError) as e:
                if attempt == 0:
                    time.sleep(5)
                    continue
                raise
    raise RuntimeError("AI API 없음 — Claude CLI, Gemini 모두 실패")


def run(keyword: str = "", top_n: int = 3) -> dict:
    """Gemini로 트렌드 분석 → 상위 N개 상품 선택 → DB 저장."""

    pool_data = [{"name": p["name"], "category": p["category"], "commissionRate": p["commissionRate"]} for p in PRODUCT_POOL]
    prompt = (
        f"쇼핑 숏츠 수익화 상품 선정. 트렌드 키워드: {keyword or '다이소 핫템'}\n"
        f"상품 풀: {json.dumps(pool_data, ensure_ascii=False)}\n"
        f"상위 {top_n}개 선택. JSON만 응답:\n"
        '{"selected":[{"name":"상품명","reason":"이유","viralScore":85}],"strategy":"전략"}'
    )

    try:
        raw = _call_ai(prompt)
        start = raw.find("{")
        end = raw.rfind("}") + 1
        parsed = json.loads(raw[start:end]) if start >= 0 else {"selected": [], "strategy": ""}
        if not parsed.get("selected"):
            raise ValueError("empty selected")
    except Exception as e:
        print(f"[product_discovery] AI 호출 실패: {e} — fallback", file=sys.stderr)
        selected_pool = sorted(PRODUCT_POOL, key=lambda x: x["commissionRate"], reverse=True)[:top_n]
        parsed = {
            "selected": [{"name": p["name"], "reason": "fallback", "viralScore": 75} for p in selected_pool],
            "strategy": "fallback — 수수료율 기준"
        }

    # 2. 선택된 상품을 DB에 저장/업데이트
    saved_ids = []
    for item in parsed.get("selected", []):
        pool_item = next((p for p in PRODUCT_POOL if p["name"] == item["name"]), None)
        if not pool_item:
            continue
        existing = db.query_one("SELECT id FROM products WHERE name = ?", [item["name"]])
        if existing:
            db.execute(
                "UPDATE products SET viral_score = ?, updated_at = datetime('now') WHERE id = ?",
                [item.get("viralScore", 75), existing["id"]]
            )
            saved_ids.append(existing["id"])
        else:
            res = db.execute(
                """INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [item["name"], pool_item["category"], pool_item["url"],
                 pool_item["commissionRate"], item.get("viralScore", 75),
                 int(pool_item["commissionRate"] * 500)]
            )
            if res.get("lastInsertRowid"):
                saved_ids.append(res["lastInsertRowid"])

    summary = f"{len(saved_ids)}개 상품 발굴 (키워드: {keyword or '다이소 핫템'})"
    print(f"[product_discovery] {summary}", flush=True)
    return {"ok": True, "product_ids": saved_ids, "summary": summary, "strategy": parsed.get("strategy", "")}


if __name__ == "__main__":
    import sys
    kw = sys.argv[1] if len(sys.argv) > 1 else ""
    print(json.dumps(run(kw), ensure_ascii=False, indent=2))
