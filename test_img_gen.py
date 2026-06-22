#!/usr/bin/env python3
import urllib.request, json, base64, sys
sys.path.insert(0, '.')
import config
from pathlib import Path

key = config.GEMINI_API_KEY
out_dir = Path("renders/tmp_test")
out_dir.mkdir(exist_ok=True)

MODELS = [
    ("gemini-2.5-flash-image", "generateContent"),
    ("gemini-3.1-flash-image", "generateContent"),
    ("gemini-3-pro-image",     "generateContent"),
    ("gemini-3.1-flash-image-preview", "generateContent"),
]

prompt = "Professional product photo of LED light bulb set, pure white background, studio lighting, sharp focus, commercial photography, no text, no people"

for model, method in MODELS:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}?key={key}"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}], "role": "user"}],
        "generationConfig": {"responseModalities": ["IMAGE"]}
    }).encode()
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        found = False
        for p in parts:
            if "inlineData" in p:
                safe_name = model.replace("/", "_").replace(".", "_")
                out = out_dir / f"{safe_name}.jpg"
                with open(out, "wb") as f:
                    f.write(base64.b64decode(p["inlineData"]["data"]))
                print(f"[OK] {model}: {out.stat().st_size // 1024}KB → {out}")
                found = True
                break
        if not found:
            print(f"[SKIP] {model}: 이미지 파트 없음 - {[list(p.keys()) for p in parts]}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:200]
        print(f"[HTTP {e.code}] {model}: {err}")
    except Exception as e:
        print(f"[ERR] {model}: {str(e)[:120]}")
