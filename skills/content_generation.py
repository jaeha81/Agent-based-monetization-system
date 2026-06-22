#!/usr/bin/env python3
"""
content_generation.py — 콘텐츠 생성 스킬
YouTube Shorts 전용 스크립트 생성 → Turso DB 저장
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

PLATFORMS = ["YouTube"]

SYSTEM_PROMPT = """당신은 한국 YouTube Shorts 전문 콘텐츠 크리에이터입니다.

30초 4씬 쇼츠 스크립트 작성 규칙:
씬1 (0-7초, Hook): 심리적 트리거 — 희소성/호기심/가격앵커/사회적증명 중 하나
씬2 (7-15초, 제품소개): 핵심 기능/특징 3가지 구체적으로
씬3 (15-23초, 혜택/가격): 가격 정보, 할인, 비교 혜택
씬4 (23-30초, CTA): "설명란 링크 클릭" + 긴박감

YouTube 규칙:
- hook: 60자 이내, 강렬한 첫 문장 (SEO 키워드 포함)
- script: 4씬 흐름이 느껴지는 200자 스크립트 (씬 전환이 명확하게)
- hashtags: #쿠팡파트너스 #광고 포함 8개 이하

JSON만 응답:
{
  "contents": [
    {
      "platform": "YouTube",
      "hook": "60자 이내 훅",
      "script": "30초 4씬 스크립트 200자",
      "hashtags": "#쿠팡파트너스 #광고 #핫딜"
    }
  ]
}"""


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
            timeout=180,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        raise RuntimeError(f"Claude CLI 실패 (returncode={result.returncode}): {result.stderr[:200]}")
    except Exception as e:
        print(f"[content_generation] Claude CLI 실패: {e} — Gemini로 폴백", file=sys.stderr)

    # 2순위: Gemini 2.0 Flash (fallback)
    if config.GEMINI_API_KEY:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-2.0-flash:generateContent?key={config.GEMINI_API_KEY}"
        )
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
        }).encode()
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=90) as resp:
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


def run(product_id: int, product_name: str, category: str,
        affiliate_url: str = "", evolution_insight: str = "") -> dict:
    """YouTube Shorts 콘텐츠 생성 → DB 저장."""

    full_prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        f"상품: {product_name}\n카테고리: {category}\n"
        f"제휴링크: {affiliate_url or '링크 없음'}\n"
        f"이전 인사이트: {evolution_insight or '첫 사이클'}\n"
        f"YouTube Shorts 콘텐츠를 JSON으로 생성:"
    )

    try:
        raw = _call_ai(full_prompt)
        start = raw.find("{")
        end = raw.rfind("}") + 1
        parsed = json.loads(raw[start:end]) if start >= 0 else {"contents": []}
        if not parsed.get("contents"):
            raise ValueError("empty contents")
    except Exception as e:
        print(f"[content_generation] AI 호출 실패: {e} — fallback 템플릿 사용", file=sys.stderr)
        parsed = {"contents": [
            {"platform": p, "hook": f"{product_name} 지금 핫딜!", "script": f"{product_name}를 소개합니다.", "hashtags": "#쿠팡파트너스 #광고"}
            for p in PLATFORMS
        ]}

    saved = 0
    for item in parsed.get("contents", []):
        # hashtags는 script 뒤에 덧붙여 보관 (DB 컬럼 없음)
        script = item.get("script", "")
        hashtags = item.get("hashtags", "")
        if hashtags and hashtags not in script:
            script = f"{script}\n\n{hashtags}"
        try:
            result = db.execute(
                """INSERT INTO content (product_id, platform, hook, script, status, target_market, language, ab_group, created_at)
                   VALUES (?, ?, ?, ?, 'draft', 'KR', 'ko', 'A', datetime('now'))""",
                [product_id, item.get("platform", "YouTube"),
                 item.get("hook", ""), script]
            )
            if result.get("last_insert_rowid") or result.get("affected_row_count", 0) > 0:
                saved += 1
        except Exception as e:
            print(f"[content_generation] DB 저장 실패: {e}", file=sys.stderr)

    # 에이전트 상태 업데이트
    try:
        db.execute(
            """UPDATE agent_states SET status='completed', last_result=?, last_run_at=datetime('now'),
               total_runs=total_runs+1, success_runs=success_runs+1 WHERE agent_name='content_agent'""",
            [f"{saved}개 콘텐츠 생성: {product_name}"]
        )
    except Exception:
        pass

    summary = f"{saved}개 콘텐츠 생성 ({product_name})"
    print(f"[content_generation] {summary}", flush=True)
    return {"ok": True, "saved": saved, "summary": summary}


if __name__ == "__main__":
    pid = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    pname = sys.argv[2] if len(sys.argv) > 2 else "테스트 상품"
    cat = sys.argv[3] if len(sys.argv) > 3 else "생활용품"
    print(json.dumps(run(pid, pname, cat), ensure_ascii=False, indent=2))
