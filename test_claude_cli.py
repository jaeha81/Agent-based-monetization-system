#!/usr/bin/env python3
"""Claude CLI stdin 방식 테스트"""
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import config

prompt = (
    "쇼핑 숏츠 수익화 상품 선정. 트렌드 키워드: 다이소 핫템\n"
    '상품 풀: [{"name":"솔로 테니스 리바운더","category":"스포츠","commissionRate":6.0},'
    '{"name":"아기 실리콘 이유식 도구 세트","category":"유아","commissionRate":7.0}]\n'
    "상위 2개 선택. JSON만 응답:\n"
    '{"selected":[{"name":"상품명","reason":"이유","viralScore":85}],"strategy":"전략"}'
)

print(f"[test] CLAUDE_CMD: {config.CLAUDE_CMD}")
print(f"[test] 프롬프트 길이: {len(prompt)}")

r = subprocess.run(
    [config.CLAUDE_CMD, "--print"],
    input=prompt,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
    timeout=90,
)
print(f"[test] returncode: {r.returncode}")
print(f"[test] stdout ({len(r.stdout)}자):\n{r.stdout[:1000]}")
if r.stderr:
    print(f"[test] stderr: {r.stderr[:200]}")
