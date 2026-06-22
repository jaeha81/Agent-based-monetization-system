#!/usr/bin/env python3
import sys, json, urllib.request, urllib.error, base64
sys.path.insert(0, '.')
import config
from pathlib import Path

# 1. 사용 가능한 이미지 모델 확인
print("=== 사용 가능한 이미지 모델 ===")
try:
    req = urllib.request.Request(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {config.OPENAI_API_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read())
    img_models = [m["id"] for m in data["data"] if any(k in m["id"] for k in ["dall", "image", "gpt-image"])]
    for m in sorted(img_models):
        print(" ", m)
except Exception as e:
    print("모델 조회 실패:", e)

# 2. gpt-image-1 (최신 OpenAI 이미지 모델) 시도
print("\n=== gpt-image-1 테스트 ===")
body = json.dumps({
    "model": "gpt-image-1",
    "prompt": "LED light bulb set, professional product photo, pure white background, studio lighting, sharp focus, no text, no people",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
}).encode()
try:
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=body,
        headers={
            "Authorization": f"Bearer {config.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read())
    print("응답 키:", list(data.keys()))
    item = data["data"][0]
    print("이미지 항목 키:", list(item.keys()))
    if "b64_json" in item:
        out = Path("renders/tmp_test/dalle_result.jpg")
        out.parent.mkdir(exist_ok=True)
        with open(out, "wb") as f:
            f.write(base64.b64decode(item["b64_json"]))
        print(f"성공(b64): {out.stat().st_size // 1024}KB")
    elif "url" in item:
        with urllib.request.urlopen(item["url"], timeout=30) as ir:
            out = Path("renders/tmp_test/dalle_result.jpg")
            with open(out, "wb") as f:
                f.write(ir.read())
        print(f"성공(url): {out.stat().st_size // 1024}KB")
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()[:400]}")
except Exception as e:
    print(f"오류: {e}")
