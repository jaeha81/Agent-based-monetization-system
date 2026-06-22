#!/usr/bin/env python3
"""
db.py — Turso DB HTTP 클라이언트 (libsql-client 불필요)
Vercel 대시보드와 동일한 Turso DB에 읽기/쓰기
"""
import json
import urllib.request
import urllib.error
from typing import Any

import config


def _pipeline(statements: list[dict]) -> list[dict]:
    """Turso /v2/pipeline 호출. statements = [{"sql": ..., "args": [...]}]"""
    if not config.TURSO_URL or not config.TURSO_TOKEN:
        raise RuntimeError("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 환경변수가 없습니다")

    requests = []
    for stmt in statements:
        args = []
        for a in stmt.get("args", []):
            if a is None:
                args.append({"type": "null"})
            elif isinstance(a, bool):
                args.append({"type": "integer", "value": str(int(a))})
            elif isinstance(a, int):
                args.append({"type": "integer", "value": str(a)})
            elif isinstance(a, float):
                args.append({"type": "float", "value": a})  # JSON number, not string
            else:
                args.append({"type": "text", "value": str(a)})
        requests.append({"type": "execute", "stmt": {"sql": stmt["sql"], "args": args}})
    requests.append({"type": "close"})

    payload = json.dumps({"requests": requests}).encode()
    # libsql:// → https:// (Turso HTTP API)
    base = config.TURSO_URL.replace("libsql://", "https://").rstrip("/")
    url = base + "/v2/pipeline"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {config.TURSO_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())["results"]
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"Turso HTTP {e.code}: {body}") from e


def execute(sql: str, args: list | None = None) -> dict:
    """단일 INSERT/UPDATE/DELETE 실행. lastInsertRowid 등 반환."""
    results = _pipeline([{"sql": sql, "args": args or []}])
    return results[0].get("response", {}).get("result", {})


def query(sql: str, args: list | None = None) -> list[dict[str, Any]]:
    """SELECT 결과를 dict 리스트로 반환."""
    results = _pipeline([{"sql": sql, "args": args or []}])
    result = results[0].get("response", {}).get("result", {})
    cols = [c["name"] for c in result.get("cols", [])]
    rows = []
    for row in result.get("rows", []):
        rows.append({cols[i]: cell.get("value") for i, cell in enumerate(row)})
    return rows


def query_one(sql: str, args: list | None = None) -> dict[str, Any] | None:
    rows = query(sql, args)
    return rows[0] if rows else None
