#!/usr/bin/env python3
"""DB INSERT 직접 테스트 — 오류 상세 출력"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import config, db

print(f"Turso URL: {config.TURSO_URL[:40]}...")

# 직접 pipeline 호출로 에러 확인
import urllib.request, urllib.error

def _pipeline_raw(statements):
    base = config.TURSO_URL.replace("libsql://", "https://").rstrip("/")
    url = base + "/v2/pipeline"
    payload = json.dumps({"requests": [{"type": "execute", "stmt": {"sql": s["sql"], "args": [{"type":"text","value":str(a)} for a in s.get("args",[])]}} for s in statements] + [{"type": "close"}]}).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "Authorization": f"Bearer {config.TURSO_TOKEN}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

# 1. content 테이블 스키마 확인
print("\n=== content 테이블 컬럼 ===")
raw = _pipeline_raw([{"sql": "PRAGMA table_info(content)", "args": []}])
cols = raw["results"][0].get("response", {}).get("result", {})
col_names = [cell["value"] for row in cols.get("rows", []) for cell, col in zip(row, cols["cols"]) if col["name"]=="name"]
print("컬럼:", col_names)

# 2. INSERT 테스트
print("\n=== INSERT 테스트 ===")
raw2 = _pipeline_raw([{"sql": "INSERT INTO content (product_id, platform, hook, script, hashtags, status) VALUES (13, 'YouTube', '테스트 훅', '테스트 스크립트', '#테스트', 'draft')", "args": []}])
result = raw2["results"][0]
print("INSERT 결과:", json.dumps(result, ensure_ascii=False, indent=2))
