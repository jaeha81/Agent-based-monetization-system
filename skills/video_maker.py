#!/usr/bin/env python3
"""
video_maker.py — 로컬 FFmpeg 영상 생성
edge-tts + PIL + moviepy로 4씬 YouTube Shorts MP4 생성 (1080x1920, 30s)
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
import db

# ── 설정 ─────────────────────────────────────────────────────────────────────
SIZE = (1080, 1920)
FONT_PATH = os.getenv("FONT_PATH", r"C:\Windows\Fonts\malgunbd.ttf")
FONT_PATH_FALLBACK = r"C:\Windows\Fonts\malgun.ttf"
BGM_PATH = os.getenv("BGM_PATH", str(Path(__file__).parent.parent / "assets" / "bgm.mp3"))
RENDERS_DIR = Path(__file__).parent.parent / "renders"
ASSETS_DIR = Path(__file__).parent.parent / "assets"
STABILITY_API_KEY = os.getenv("STABILITY_API_KEY", "").replace("﻿", "").strip()
STABILITY_API = "https://api.stability.ai/v2beta/stable-image/generate/sd3"

# 씬 설정 (duration, bg_start_rgb, bg_end_rgb) — 선명한 색상
SCENES_CONFIG = [
    (7,  (58, 10, 125),  (118, 48, 198)),   # 씬1: 바이올렛 — Hook
    (8,  (10, 38, 108),  (22, 80, 172)),    # 씬2: 코발트블루 — 제품 소개
    (8,  (142, 60, 5),   (212, 112, 15)),   # 씬3: 버닝오렌지 — 혜택/가격
    (7,  (150, 12, 12),  (222, 55, 55)),    # 씬4: 크림슨레드 — CTA
]
TOTAL_DURATION = sum(d for d, _, _ in SCENES_CONFIG)

SCENE_LABELS = ["HOOK", "제품 소개", "특별 혜택", "지금 구매"]
SCENE_ACCENT_COLORS = [
    (255, 215, 50),   # 씬1: 골드
    (60,  212, 255),  # 씬2: 스카이블루
    (255, 232, 30),   # 씬3: 밝은 노랑
    (255, 255, 80),   # 씬4: 밝은 노랑
]

RENDERS_DIR.mkdir(exist_ok=True)
ASSETS_DIR.mkdir(exist_ok=True)


# ── AI 호출 ──────────────────────────────────────────────────────────────────
def _call_ai(prompt: str) -> str:
    """Claude CLI → Gemini fallback."""
    try:
        result = subprocess.run(
            [config.CLAUDE_CMD, "--print"],
            input=prompt,
            capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=120,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        raise RuntimeError(result.stderr[:200])
    except Exception as e:
        print(f"[video_maker] Claude CLI 실패: {e} → Gemini 폴백", file=sys.stderr)

    if config.GEMINI_API_KEY:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-2.0-flash:generateContent?key={config.GEMINI_API_KEY}"
        )
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.6, "maxOutputTokens": 1024},
        }).encode()
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e2:
            print(f"[video_maker] Gemini 실패: {str(e2)[:100]}", file=sys.stderr)

    raise RuntimeError("AI API 없음")


def generate_scenario(hook: str, script: str, product_name: str, coupang_url: str) -> dict:
    """hook + script → 4씬 JSON 시나리오 생성."""
    prompt = f"""당신은 한국 YouTube Shorts 영상 감독입니다.
아래 정보로 30초 쇼츠의 4씬 시나리오를 JSON으로만 만드세요.

제품: {product_name}
훅: {hook}
스크립트: {script[:300]}
구매링크: {coupang_url or 'https://www.coupang.com'}

규칙:
- display_text: 화면에 표시할 텍스트 (각 줄 15자 이내, 최대 3줄)
- tts: 해당 씬에서 읽을 음성 텍스트 (자연스러운 구어체 한국어)
- 씬1 tts: 7초 분량 (~40자), 씬2/3 tts: 8초 분량 (~50자), 씬4 tts: 7초 분량 (~40자)

JSON만 출력 (다른 텍스트 없이):
{{
  "scene1": {{"display_text": ["훅 첫줄", "훅 둘째줄"], "tts": "훅 음성"}},
  "scene2": {{"display_text": ["제품명", "특징1", "특징2"], "tts": "제품 소개 음성"}},
  "scene3": {{"display_text": ["혜택 텍스트", "가격 정보"], "tts": "혜택 설명 음성"}},
  "scene4": {{"display_text": ["지금 구매!", "설명란 링크"], "tts": "CTA 음성"}}
}}"""

    try:
        raw = _call_ai(prompt)
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start < 0:
            raise ValueError("JSON 없음")
        return json.loads(raw[start:end])
    except Exception as e:
        print(f"[video_maker] 시나리오 생성 실패: {e} → 기본 시나리오 사용", file=sys.stderr)
        return {
            "scene1": {"display_text": [hook[:15], hook[15:30] or ""], "tts": hook[:40]},
            "scene2": {"display_text": [product_name[:15], "최고 품질", "합리적 가격"], "tts": f"{product_name} 소개합니다. 품질과 가격 모두 만족스러운 제품이에요."},
            "scene3": {"display_text": ["지금 할인 중!", "오늘만 이 가격"], "tts": "지금 구매하시면 특별 할인가로 만나보실 수 있어요. 놓치지 마세요!"},
            "scene4": {"display_text": ["지금 바로 구매!", "설명란 링크 클릭"], "tts": "지금 바로 설명란 링크를 눌러 구매하세요! 쿠팡 최저가 확인하세요."},
        }


# ── 쿠팡 상품 이미지 추출 ────────────────────────────────────────────────────
def fetch_coupang_image(product_url: str, out_path: str) -> bool:
    """쿠팡 상품 URL → og:image 추출 후 로컬 저장."""
    if not product_url or "coupang.com" not in product_url:
        return False
    import re
    import http.cookiejar
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
        "Referer": "https://www.coupang.com/",
    }
    try:
        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        req = urllib.request.Request(product_url, headers=headers)
        with opener.open(req, timeout=25) as resp:
            raw_bytes = resp.read()
            # gzip 자동 디코딩
            try:
                import gzip
                html = gzip.decompress(raw_bytes).decode("utf-8", errors="replace")
            except Exception:
                html = raw_bytes.decode("utf-8", errors="replace")

        # og:image 또는 product image 태그 추출
        for pattern in [
            r'property=["\']og:image["\']\s+content=["\'](https?://[^"\'?\s]+)',
            r'content=["\'](https?://[^"\'?\s]+)["\']\s+property=["\']og:image["\']',
            r'"fullImage"\s*:\s*"(https?://[^"]+)"',
        ]:
            m = re.search(pattern, html)
            if m:
                img_url = m.group(1).split("?")[0]  # 쿼리스트링 제거
                img_req = urllib.request.Request(img_url, headers={"User-Agent": headers["User-Agent"]})
                with urllib.request.urlopen(img_req, timeout=20) as ir:
                    raw = ir.read()
                if len(raw) < 2000:
                    continue
                with open(out_path, "wb") as f:
                    f.write(raw)
                # WebP/etc → JPEG 변환
                try:
                    from PIL import Image as _PImage
                    _img = _PImage.open(out_path).convert("RGB")
                    _img.save(out_path, "JPEG", quality=92)
                except Exception:
                    pass
                if Path(out_path).exists() and Path(out_path).stat().st_size > 2000:
                    print(f"[video_maker] 쿠팡 상품 이미지 취득: {img_url[:60]}...")
                    return True
        print("[video_maker] 쿠팡 og:image 패턴 매칭 실패", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[video_maker] 쿠팡 이미지 추출 실패: {e}", file=sys.stderr)
        return False


# ── AI 이미지 생성 폴백 체인 ────────────────────────────────────────────────
_CATEGORY_HINT = {
    "유아": "baby product, infant care item",
    "스포츠": "sports equipment, fitness gear",
    "뷰티": "beauty product, skincare cosmetics",
    "주방": "kitchen appliance, cooking tool",
    "전자": "consumer electronics, gadget",
    "생활": "household item, home goods",
    "식품": "premium food product, packaged food",
    "패션": "fashion accessory, apparel",
}

# 제품명 키워드 → 영문 설명 (Pollinations 정확도 향상)
_PRODUCT_KEYWORD_MAP = [
    ("전구", "light bulb, LED bulb"),
    ("LED", "LED light bulb"),
    ("마스크", "face mask"),
    ("칫솔", "toothbrush"),
    ("샴푸", "shampoo bottle"),
    ("스킨", "skincare bottle"),
    ("크림", "cream jar"),
    ("에어프라이어", "air fryer"),
    ("블렌더", "blender"),
    ("커피", "coffee product"),
    ("텀블러", "tumbler cup"),
    ("운동화", "sneakers"),
    ("가방", "bag"),
    ("이어폰", "earphones"),
    ("충전기", "charger"),
    ("보조배터리", "power bank"),
    ("청소기", "vacuum cleaner"),
    ("헤어드라이어", "hair dryer"),
    ("선크림", "sunscreen"),
    ("립스틱", "lipstick"),
    ("파운데이션", "foundation makeup"),
    ("세탁세제", "laundry detergent"),
    ("주방세제", "dish soap"),
]

def _image_prompt(product_name: str, category: str) -> str:
    category_hint = next((v for k, v in _CATEGORY_HINT.items() if k in category), "consumer product")
    # 제품명에서 키워드 추출 → 더 구체적인 영문 설명
    product_hint = next(
        (eng for kor, eng in _PRODUCT_KEYWORD_MAP if kor in product_name),
        ""
    )
    subject = f"{product_hint}, " if product_hint else ""
    return (
        f"{product_name}, {subject}{category_hint}, "
        "professional product photography, pure white background, "
        "studio lighting, sharp focus, high resolution commercial photo, "
        "no text, no watermark, no people"
    )


def _gen_gemini_imagen(product_name: str, category: str, out_path: str) -> bool:
    """Gemini Imagen 3 (재미나) 제품 이미지 생성."""
    if not config.GEMINI_API_KEY:
        return False
    prompt = _image_prompt(product_name, category)
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"imagen-3.0-generate-002:predict?key={config.GEMINI_API_KEY}"
    )
    body = json.dumps({
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1, "aspectRatio": "1:1", "outputMimeType": "image/jpeg"},
    }).encode()
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        img_b64 = data["predictions"][0]["bytesBase64Encoded"]
        import base64
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(img_b64))
        print(f"[video_maker] Gemini Imagen 3 생성 완료: {out_path}")
        return Path(out_path).stat().st_size > 2000
    except Exception as e:
        print(f"[video_maker] Gemini Imagen 실패: {str(e)[:120]}", file=sys.stderr)
        return False


def _gen_gemini_flash(product_name: str, category: str, out_path: str) -> bool:
    """Gemini 2.0 Flash 멀티모달 이미지 생성 (재미나 폴백)."""
    if not config.GEMINI_API_KEY:
        return False
    prompt = _image_prompt(product_name, category)
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash-preview-image-generation:generateContent?key={config.GEMINI_API_KEY}"
    )
    body = json.dumps({
        "contents": [{"parts": [{"text": f"Generate a product image: {prompt}"}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "responseMimeType": "image/jpeg"},
    }).encode()
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        import base64
        for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
            if "inlineData" in part:
                with open(out_path, "wb") as f:
                    f.write(base64.b64decode(part["inlineData"]["data"]))
                print(f"[video_maker] Gemini Flash 이미지 생성 완료: {out_path}")
                return Path(out_path).stat().st_size > 2000
        return False
    except Exception as e:
        print(f"[video_maker] Gemini Flash 이미지 실패: {str(e)[:120]}", file=sys.stderr)
        return False


def _gen_dalle(product_name: str, category: str, out_path: str) -> bool:
    """gpt-image-1 (GPT) 제품 이미지 생성."""
    if not config.OPENAI_API_KEY:
        return False
    prompt = _image_prompt(product_name, category)
    body = json.dumps({
        "model": "gpt-image-1",
        "prompt": prompt[:1000],
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
        import base64
        item = data["data"][0]
        if "b64_json" in item:
            with open(out_path, "wb") as f:
                f.write(base64.b64decode(item["b64_json"]))
        elif "url" in item:
            with urllib.request.urlopen(item["url"], timeout=30) as ir:
                with open(out_path, "wb") as f:
                    f.write(ir.read())
        else:
            return False
        print(f"[video_maker] gpt-image-1 이미지 생성 완료: {out_path}")
        return Path(out_path).stat().st_size > 2000
    except Exception as e:
        print(f"[video_maker] gpt-image-1 실패: {str(e)[:120]}", file=sys.stderr)
        return False


def _gen_pollinations(product_name: str, category: str, out_path: str) -> bool:
    """Pollinations.ai 무료 이미지 생성 (API 키 불필요)."""
    import urllib.parse
    prompt = _image_prompt(product_name, category)
    encoded = urllib.parse.quote(prompt[:500])
    # nologo=true, model=flux (고품질)
    url = f"https://image.pollinations.ai/prompt/{encoded}?width=1024&height=1024&model=flux&nologo=true&seed=42"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
        if len(raw) < 5000:
            return False
        with open(out_path, "wb") as f:
            f.write(raw)
        # JPEG 변환 보장
        try:
            from PIL import Image as _PI
            _PI.open(out_path).convert("RGB").save(out_path, "JPEG", quality=90)
        except Exception:
            pass
        print(f"[video_maker] Pollinations 이미지 생성 완료: {out_path}")
        return Path(out_path).stat().st_size > 5000
    except Exception as e:
        print(f"[video_maker] Pollinations 실패: {str(e)[:120]}", file=sys.stderr)
        return False


def _gen_claude_cli(product_name: str, category: str, out_path: str) -> bool:
    """Claude CLI (코덱스) 이미지 설명 → Gemini 재시도 프롬프트 강화."""
    if not config.GEMINI_API_KEY:
        return False
    prompt_req = (
        f"제품명: {product_name}, 카테고리: {category}\n"
        "위 제품의 전문 상품 사진 생성을 위한 최적화된 영문 프롬프트를 한 문장으로만 출력하세요. "
        "예시: 'red wireless earbuds, professional product photo, white background, studio light'"
    )
    try:
        result = subprocess.run(
            [config.CLAUDE_CMD, "--print"],
            input=prompt_req, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=60,
        )
        enhanced = result.stdout.strip() if result.returncode == 0 else ""
        if not enhanced:
            return False
        # 강화된 프롬프트로 Gemini Imagen 재시도
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"imagen-3.0-generate-002:predict?key={config.GEMINI_API_KEY}"
        )
        body = json.dumps({
            "instances": [{"prompt": enhanced[:500]}],
            "parameters": {"sampleCount": 1, "aspectRatio": "1:1", "outputMimeType": "image/jpeg"},
        }).encode()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        import base64
        img_b64 = data["predictions"][0]["bytesBase64Encoded"]
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(img_b64))
        print(f"[video_maker] Claude+Imagen 이미지 생성 완료: {out_path}")
        return Path(out_path).stat().st_size > 2000
    except Exception as e:
        print(f"[video_maker] Claude+Imagen 실패: {str(e)[:120]}", file=sys.stderr)
        return False


def generate_product_image(product_name: str, category: str, out_path: str) -> bool:
    """AI 폴백 체인: gpt-image-1 → Gemini Imagen → Gemini Flash → Claude+Imagen → Pollinations(무료)."""
    generators = [
        ("gpt-image-1",      lambda: _gen_dalle(product_name, category, out_path)),
        ("Gemini Imagen 3",  lambda: _gen_gemini_imagen(product_name, category, out_path)),
        ("Gemini Flash",     lambda: _gen_gemini_flash(product_name, category, out_path)),
        ("Claude+Imagen",    lambda: _gen_claude_cli(product_name, category, out_path)),
        ("Pollinations",     lambda: _gen_pollinations(product_name, category, out_path)),
    ]
    for name, fn in generators:
        print(f"[video_maker] 이미지 생성 시도: {name}")
        try:
            if fn():
                return True
        except Exception as e:
            print(f"[video_maker] {name} 예외: {e}", file=sys.stderr)
    print("[video_maker] 모든 이미지 생성 실패 → 텍스트 카드로 대체", file=sys.stderr)
    return False


# ── TTS 생성 ─────────────────────────────────────────────────────────────────
async def _tts_async(text: str, out_path: str, voice: str = "ko-KR-SunHiNeural") -> None:
    import edge_tts
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(out_path)


def generate_tts(text: str, out_path: str) -> bool:
    """edge-tts로 한국어 TTS 생성."""
    try:
        asyncio.run(_tts_async(text, out_path))
        return Path(out_path).exists() and Path(out_path).stat().st_size > 100
    except Exception as e:
        print(f"[video_maker] TTS 생성 실패: {e}", file=sys.stderr)
        return False


# ── PIL 씬 이미지 생성 ────────────────────────────────────────────────────────
# ── 배경/효과 공통 헬퍼 ──────────────────────────────────────────────────────
def _diagonal_gradient(W: int, H: int, c1: tuple, c2: tuple, angle: float = 0.55) -> np.ndarray:
    """대각선 그라데이션 배경 numpy 배열 생성."""
    xs = np.linspace(0, 1, W, dtype=np.float32)
    ys = np.linspace(0, 1, H, dtype=np.float32)
    t = np.clip(xs[np.newaxis, :] * (1 - angle) + ys[:, np.newaxis] * angle, 0, 1)
    arr = np.stack([
        np.clip(c1[i] + (c2[i] - c1[i]) * t, 0, 255).astype(np.uint8)
        for i in range(3)
    ], axis=2)
    return arr


def _add_noise(arr: np.ndarray, strength: int = 14) -> np.ndarray:
    """미세 노이즈로 단조로운 단색 배경 질감 부여."""
    rng = np.random.default_rng(42)
    noise = rng.integers(-strength, strength + 1, arr.shape, dtype=np.int16)
    return np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def _radial_glow(W: int, H: int, cx: int, cy: int,
                 radius: int, color: tuple, alpha: int = 80) -> "Image.Image":
    """중심에서 퍼지는 원형 빛 효과 RGBA 레이어."""
    from PIL import Image, ImageDraw, ImageFilter
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ov).ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
                               fill=(*color, alpha))
    return ov.filter(ImageFilter.GaussianBlur(radius // 2))


def _shadow_layer(W: int, H: int, x1: int, y1: int, x2: int, y2: int,
                  radius: int = 32, blur: int = 20, alpha: int = 140) -> "Image.Image":
    """드롭 섀도 RGBA 레이어."""
    from PIL import Image, ImageDraw, ImageFilter
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ov).rounded_rectangle(
        [x1 + blur // 3, y1 + blur // 2, x2 + blur // 3, y2 + blur // 2],
        radius=radius, fill=(0, 0, 0, alpha),
    )
    return ov.filter(ImageFilter.GaussianBlur(blur))


def _load_scene_bg(scene_img_path: str | None) -> "Image.Image | None":
    """FLUX 씬 이미지를 1080x1920으로 로드. 없으면 None."""
    if not scene_img_path or not Path(scene_img_path).exists():
        return None
    from PIL import Image
    img = Image.open(scene_img_path).convert("RGB")
    if img.size != SIZE:
        img = img.resize(SIZE, Image.LANCZOS)
    return img


def _ken_burns_clip(img_arr: np.ndarray, duration: float,
                    effect: str = "zoom_in") -> "VideoClip":
    """Ken Burns pan/zoom 효과 클립 생성 (moviepy VideoClip make_frame 방식)."""
    from PIL import Image
    from moviepy import VideoClip
    W, H = SIZE
    img = Image.fromarray(img_arr)
    SCALE = 1.06  # 6% 확대

    def make_frame(t):
        p = min(t / duration, 1.0)  # 0.0 → 1.0 진행도
        if effect == "zoom_in":
            s = 1.0 + (SCALE - 1.0) * p
        elif effect == "zoom_out":
            s = SCALE - (SCALE - 1.0) * p
        else:
            s = SCALE

        nw, nh = int(W * s), int(H * s)
        resized = img.resize((nw, nh), Image.BILINEAR)

        if effect in ("zoom_in", "zoom_out"):
            x, y = (nw - W) // 2, (nh - H) // 2
        elif effect == "pan_right":
            x = int((nw - W) * p)
            y = (nh - H) // 2
        elif effect == "pan_left":
            x = int((nw - W) * (1.0 - p))
            y = (nh - H) // 2
        else:
            x, y = (nw - W) // 2, (nh - H) // 2

        return np.array(resized.crop((x, y, x + W, y + H)))

    return VideoClip(make_frame, duration=duration)


def _draw_scene_counter(img: "Image.Image", scene_idx: int,
                        font_badge: "ImageFont.ImageFont") -> "Image.Image":
    """우상단 씬 카운터 N/4 — 노랑 숫자 + 흰 /4 + 검정 반투명 박스."""
    from PIL import Image, ImageDraw
    W, H = img.size
    bx1, by1, bx2, by2 = W - 215, 38, W - 38, 138
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ov).rounded_rectangle(
        [bx1, by1, bx2, by2], radius=22, fill=(0, 0, 0, 210)
    )
    img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
    draw = ImageDraw.Draw(img)
    cx = (bx1 + bx2) // 2
    cy = (by1 + by2) // 2
    draw.text((cx - 28, cy), str(scene_idx + 1), font=font_badge,
              anchor="mm", fill=(255, 215, 50))
    draw.text((cx + 32, cy), "/4", font=font_badge,
              anchor="mm", fill=(255, 255, 255))
    return img


def _draw_caption_bar(img: "Image.Image", lines: list, fonts: tuple,
                      accent: tuple, box_color=(0, 0, 0),
                      box_alpha: int = 200) -> "Image.Image":
    """하단 전폭 박스 자막 (참고 영상 스타일). 맨 아래 배치."""
    from PIL import Image, ImageDraw
    W, H = img.size
    font_hero, font_main, font_sub = fonts[0], fonts[1], fonts[2]
    text_lines = [l for l in lines if l.strip()][:3]
    if not text_lines:
        return img
    line_h = 128
    pad_top, pad_bot = 48, 38
    total_h = len(text_lines) * line_h + pad_top + pad_bot
    by1 = H - total_h - 30
    by2 = H - 30
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ov).rounded_rectangle(
        [0, by1, W, by2], radius=28, fill=(*box_color, box_alpha)
    )
    img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(text_lines):
        font = font_hero if i == 0 else (font_main if i == 1 else font_sub)
        color = accent if i == 0 else (255, 255, 255)
        ty = by1 + pad_top + i * line_h
        draw.text((W // 2, ty), line, font=font, anchor="ms",
                  fill=color, stroke_width=2, stroke_fill=(0, 0, 0))
    return img


def _paste_product(img: "Image.Image", prod_orig: "Image.Image",
                   max_size: int, px: int, py: int,
                   card_color=(255, 255, 255), card_alpha=255,
                   card_pad=36, card_radius=36) -> tuple:
    """흰 카드 + 드롭 섀도 위에 제품 이미지 합성. (img, card_x1,y1,x2,y2) 반환."""
    from PIL import Image, ImageDraw
    W, H = img.size
    prod = prod_orig.copy()
    prod.thumbnail((max_size, max_size), Image.LANCZOS)
    cx1 = px - card_pad
    cy1 = py - card_pad
    cx2 = px + prod.width + card_pad
    cy2 = py + prod.height + card_pad
    # 그림자
    shadow = _shadow_layer(W, H, cx1, cy1, cx2, cy2, radius=card_radius, blur=22, alpha=140)
    img = Image.alpha_composite(img.convert("RGBA"), shadow).convert("RGB")
    # 카드
    card_ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(card_ov).rounded_rectangle(
        [cx1, cy1, cx2, cy2], radius=card_radius, fill=(*card_color, card_alpha)
    )
    img = Image.alpha_composite(img.convert("RGBA"), card_ov).convert("RGB")
    # 제품
    base = img.convert("RGBA")
    base.paste(prod, (px, py), prod)
    return base.convert("RGB"), cx1, cy1, cx2, cy2


def _load_fonts() -> tuple:
    """폰트 로드 (hero/main/sub/badge/cta)."""
    from PIL import ImageFont
    sizes = [100, 76, 58, 44, 54]
    fonts = []
    for sz in sizes:
        for path in [FONT_PATH, FONT_PATH_FALLBACK]:
            try:
                fonts.append(ImageFont.truetype(path, sz))
                break
            except Exception:
                pass
        else:
            fonts.append(ImageFont.load_default())
    return tuple(fonts)  # hero, main, sub, badge, cta


def _text_card(img: "Image.Image", lines: list[str], fonts: tuple,
               y_start: int, accent: tuple, align: str = "center",
               x_left: int = 55, x_right: int = -1) -> "Image.Image":
    """둥근 반투명 텍스트 카드 그리기."""
    from PIL import Image, ImageDraw
    W, H = img.size
    if x_right < 0:
        x_right = W - 55
    font_hero, font_main, font_sub = fonts[0], fonts[1], fonts[2]
    lines = [l for l in lines if l.strip()]
    line_h = 130
    card_y1 = y_start - 50
    card_y2 = min(card_y1 + len(lines) * line_h + 60, H - 70)
    card_ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(card_ov).rounded_rectangle(
        [x_left, card_y1, x_right, card_y2], radius=34, fill=(0, 0, 0, 148)
    )
    img = Image.alpha_composite(img.convert("RGBA"), card_ov).convert("RGB")
    draw = ImageDraw.Draw(img)
    cx = (x_left + x_right) // 2
    for i, line in enumerate(lines):
        if card_y1 + (i + 1) * line_h > H - 60:
            break
        font = font_hero if i == 0 else (font_main if i == 1 else font_sub)
        ty = y_start + i * line_h
        color = accent if i == 0 else (255, 255, 255)
        x = cx if align == "center" else x_left + 40
        anchor = "ms" if align == "center" else "ls"
        draw.text((x, ty), line, font=font, anchor=anchor,
                  fill=color, stroke_width=3, stroke_fill=(0, 0, 0))
    return img, card_y2


# ── 씬별 독립 레이아웃 ────────────────────────────────────────────────────────

def _strip_emoji(text: str) -> str:
    """PIL 기본 폰트가 렌더 못하는 이모지 제거."""
    import re
    return re.sub(
        r'[\U00010000-\U0010FFFF'
        r'\U0001F000-\U0001FFFF'
        r'\U00002500-\U00002BFF'
        r'\U00002702-\U000027B0'
        r'☀-⛿]',
        '', text, flags=re.UNICODE,
    ).strip()


def _scene_with_flux_bg(scene_idx: int, lines: list, accent: tuple,
                        scene_bg: str | None,
                        prod_path: str | None = None) -> np.ndarray | None:
    """FLUX/SDXL 배경 이미지 있으면 즉시 렌더. 없으면 None 반환 (PIL 폴백 진행)."""
    from PIL import Image, ImageDraw, ImageEnhance
    bg = _load_scene_bg(scene_bg)
    if bg is None:
        return None
    W, H = SIZE
    # 배경 밝기 조정 (씬별 분위기)
    brightness = [0.68, 0.82, 0.72, 0.65][scene_idx]
    img = ImageEnhance.Brightness(bg).enhance(brightness)
    # 하단 그라데이션 오버레이 (텍스트 가독성)
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for y in range(H // 2, H):
        alpha = int(180 * (y - H // 2) / (H // 2))
        ImageDraw.Draw(grad).line([(0, y), (W, y)], fill=(0, 0, 0, alpha))
    img = Image.alpha_composite(img.convert("RGBA"), grad).convert("RGB")
    # 폰트 로드
    font_hero, font_main, font_sub, font_badge, font_cta = _load_fonts()
    # 씬2(Showcase): 실제 제품이미지 배경 위에 overlay
    if scene_idx == 1 and prod_path and Path(prod_path).exists():
        prod_orig = Image.open(prod_path).convert("RGBA")
        px = (W - min(680, prod_orig.width)) // 2
        img, _, _, _, _ = _paste_product(
            img, prod_orig, 680, px, 120,
            card_color=(255, 255, 255), card_alpha=230, card_pad=32, card_radius=32
        )
    # 이모지 제거 후 캡션 박스 + 카운터
    clean_lines = [_strip_emoji(l) for l in lines]
    accent_colors = [(255, 215, 50), (60, 212, 255), (255, 232, 30), (255, 255, 80)]
    acc = accent_colors[scene_idx]
    img = _draw_caption_bar(img, clean_lines, (font_hero, font_main, font_sub),
                            acc, box_color=(0, 0, 0), box_alpha=210)
    img = _draw_scene_counter(img, scene_idx, font_badge)
    ImageDraw.Draw(img).rectangle([0, H - 8, W, H], fill=acc)
    return np.array(img.convert("RGB"))


def _scene0_hook(lines, prod_path, product_name, accent, scene_bg=None):
    """씬1 Hook — 어두운 배경, 제품 우측 티저, 훅 텍스트 좌측."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = SIZE
    # FLUX 배경 있으면 즉시 반환
    flux = _scene_with_flux_bg(0, lines, accent, scene_bg, prod_path=prod_path)
    if flux is not None:
        return flux
    # 대각선 어두운 그라데이션 (딥 네이비 → 딥 퍼플)
    arr = _diagonal_gradient(W, H, (8, 6, 28), (35, 12, 65), angle=0.6)
    arr = _add_noise(arr, 10)
    img = Image.fromarray(arr)
    # 중앙 상단 원형 빛 효과
    glow = _radial_glow(W, H, W // 2, H // 4, 500, (80, 40, 180), alpha=55)
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    font_hero, font_main, font_sub, font_badge, font_cta = _load_fonts()

    # 제품 이미지 — 우측 편향, 상단 절반
    if prod_path and Path(prod_path).exists():
        prod_orig = Image.open(prod_path).convert("RGBA")
        prod = prod_orig.copy()
        prod.thumbnail((520, 520), Image.LANCZOS)
        px = W - prod.width - 40        # 우측 정렬
        py = 160
        img, cx1, cy1, cx2, cy2 = _paste_product(
            img, prod_orig, 520, px, py,
            card_color=(255, 255, 255), card_alpha=255, card_pad=28, card_radius=28
        )
        # 카드에 "NEW" 스티커
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(ov).ellipse([cx2 - 90, cy1 - 50, cx2 + 50, cy1 + 90],
                                   fill=(255, 50, 50, 240))
        img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
        ImageDraw.Draw(img).text((cx2 - 20, cy1 + 20), "NEW", font=font_badge,
                                 anchor="mm", fill=(255, 255, 255))
        prod_bottom = cy2
    else:
        prod_bottom = 400

    # 세로 액센트 바 (좌측)
    draw = ImageDraw.Draw(img)
    draw.rectangle([28, 200, 46, prod_bottom], fill=accent)

    # 훅 텍스트 — 하단 박스 자막 스타일 (참고 영상)
    img = _draw_caption_bar(img, lines, (font_hero, font_main, font_sub),
                            accent, box_color=(0, 0, 0), box_alpha=210)

    # 씬 카운터 1/4
    img = _draw_scene_counter(img, 0, font_badge)

    # 하단 액센트 바
    ImageDraw.Draw(img).rectangle([0, H - 8, W, H], fill=accent)
    return np.array(img.convert("RGB"))


def _scene1_showcase(lines, prod_path, product_name, accent, scene_bg=None):
    """씬2 Showcase — 밝은 크림 배경, 제품 센터 대형, 특징 하단."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = SIZE
    flux = _scene_with_flux_bg(1, lines, accent, scene_bg, prod_path=prod_path)
    if flux is not None:
        return flux
    # 밝은 크림-화이트 대각선 (스튜디오 느낌)
    arr = _diagonal_gradient(W, H, (248, 246, 240), (225, 230, 248), angle=0.45)
    arr = _add_noise(arr, 6)
    img = Image.fromarray(arr)
    # 상단 컬러 배너 (액센트 색)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, 120], fill=(*accent[:3], 255) if len(accent) == 3 else accent)

    font_hero, font_main, font_sub, font_badge, font_cta = _load_fonts()

    # 브랜드/상단 텍스트
    draw.text((W // 2, 62), "✦ BEST PICK ✦", font=font_badge, anchor="mm", fill=(20, 20, 20))

    # 제품 이미지 — 화면 중앙 대형
    prod_bottom = 900
    if prod_path and Path(prod_path).exists():
        prod_orig = Image.open(prod_path).convert("RGBA")
        px_center = (W - min(880, prod_orig.width)) // 2
        img, cx1, cy1, cx2, cy2 = _paste_product(
            img, prod_orig, 880, px_center, 150,
            card_color=(255, 255, 255), card_alpha=255, card_pad=44, card_radius=44
        )
        prod_bottom = cy2
        # 배지 — 카드 우상단
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(ov).rounded_rectangle(
            [cx2 - 200, cy1 - 10, cx2 + 10, cy1 + 80], radius=24,
            fill=(255, 60, 60, 240)
        )
        img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
        ImageDraw.Draw(img).text((cx2 - 95, cy1 + 35), "SALE 🔥", font=font_badge,
                                 anchor="mm", fill=(255, 255, 255))
    else:
        # 이미지 없으면 제품명 대형 카드
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(ov).rounded_rectangle([60, 160, W - 60, 780], radius=44,
                                              fill=(255, 255, 255, 230))
        img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
        ImageDraw.Draw(img).text((W // 2, 470), product_name[:18], font=font_hero,
                                 anchor="mm", fill=(30, 30, 30))
        prod_bottom = 800

    # 특징 텍스트 — 박스 자막 스타일 (밝은 배경이므로 검정 박스)
    img = _draw_caption_bar(img, lines, (font_hero, font_main, font_sub),
                            (30, 30, 30), box_color=(20, 20, 20), box_alpha=195)

    # 씬 카운터 2/4
    img = _draw_scene_counter(img, 1, font_badge)

    # 하단 액센트 바
    ImageDraw.Draw(img).rectangle([0, H - 8, W, H], fill=accent)
    return np.array(img.convert("RGB"))


def _scene2_benefits(lines, prod_path, product_name, accent, scene_bg=None):
    """씬3 Benefits — 분할 배경, 제품 좌측 + 혜택 우측."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = SIZE
    flux = _scene_with_flux_bg(2, lines, accent, scene_bg, prod_path=prod_path)
    if flux is not None:
        return flux
    # 상단 60% 따뜻한 앰버-오렌지, 하단 40% 딥 레드
    split = int(H * 0.58)
    top_arr = _diagonal_gradient(W, split, (180, 70, 8), (230, 120, 10), angle=0.5)
    bot_arr = _diagonal_gradient(W, H - split, (120, 10, 10), (60, 5, 5), angle=0.6)
    top_arr = _add_noise(top_arr, 12)
    bot_arr = _add_noise(bot_arr, 10)
    full_arr = np.concatenate([top_arr, bot_arr], axis=0)
    img = Image.fromarray(full_arr)

    # 분할선 장식
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, split - 3, W, split + 3], fill=(255, 200, 50))

    font_hero, font_main, font_sub, font_badge, font_cta = _load_fonts()

    # 상단 레이블
    draw.text((W // 2, 55), "🔥 특별 혜택", font=font_badge, anchor="mm", fill=(255, 240, 200))

    # 제품 이미지 — 좌측 상단 (상단 절반 내)
    prod_right = 0
    if prod_path and Path(prod_path).exists():
        prod_orig = Image.open(prod_path).convert("RGBA")
        img, cx1, cy1, cx2, cy2 = _paste_product(
            img, prod_orig, 520, 40, 110,
            card_color=(255, 255, 255), card_alpha=255, card_pad=28, card_radius=28
        )
        prod_right = cx2

    # 혜택 텍스트 — 우측, 빨강 박스 자막 스타일
    text_lines = [l for l in lines if l.strip()]
    tx = max(prod_right + 20, W // 2 + 10)
    ty_start = 145
    for i, line in enumerate(text_lines[:3]):
        font = font_main if i == 0 else font_sub
        tw = tx
        tw_end = W - 230  # 카운터 박스(우상단) 침범 방지
        line_h_box = 130
        by1 = ty_start + i * line_h_box - 10
        by2 = by1 + line_h_box - 6
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        box_col = (200, 30, 30, 230) if i == 0 else (0, 0, 0, 190)
        ImageDraw.Draw(ov).rounded_rectangle([tw - 8, by1, tw_end, by2],
                                              radius=18, fill=box_col)
        img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
        draw = ImageDraw.Draw(img)
        draw.text(((tw + tw_end) // 2, (by1 + by2) // 2), line, font=font,
                  anchor="mm", fill=(255, 255, 255),
                  stroke_width=2, stroke_fill=(0, 0, 0))

    # 하단 박스 자막
    img = _draw_caption_bar(img, text_lines[-2:] if len(text_lines) >= 2 else text_lines,
                            (font_hero, font_main, font_sub),
                            (255, 220, 50), box_color=(0, 0, 0), box_alpha=200)

    # 씬 카운터 3/4
    img = _draw_scene_counter(img, 2, font_badge)

    ImageDraw.Draw(img).rectangle([0, H - 8, W, H], fill=(255, 200, 50))
    return np.array(img.convert("RGB"))


def _scene3_cta(lines, prod_path, product_name, accent, scene_bg=None):
    """씬4 CTA — 드라마틱 레드-블랙, 제품 상단, 전체폭 CTA 버튼."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = SIZE
    flux = _scene_with_flux_bg(3, lines, accent, scene_bg, prod_path=prod_path)
    if flux is not None:
        return flux
    # 딥 레드 → 거의 블랙 대각선
    arr = _diagonal_gradient(W, H, (100, 8, 8), (10, 4, 4), angle=0.65)
    arr = _add_noise(arr, 12)
    img = Image.fromarray(arr)
    # 중앙 빛 효과
    glow = _radial_glow(W, H, W // 2, H // 3, 420, (200, 40, 40), alpha=60)
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    font_hero, font_main, font_sub, font_badge, font_cta = _load_fonts()
    draw = ImageDraw.Draw(img)

    # 상단 레이블
    draw.text((W // 2, 55), "⚡ 지금 바로 구매", font=font_badge, anchor="mm",
              fill=(255, 200, 50))
    draw.rectangle([0, 0, W, 8], fill=accent)

    # 제품 이미지 — 상단 중앙 (이전보다 크게)
    prod_bottom = 900
    if prod_path and Path(prod_path).exists():
        prod_orig = Image.open(prod_path).convert("RGBA")
        px_c = (W - 620) // 2
        img, cx1, cy1, cx2, cy2 = _paste_product(
            img, prod_orig, 620, px_c, 95,
            card_color=(40, 10, 10), card_alpha=210, card_pad=28, card_radius=28
        )
        prod_bottom = cy2

    # 중간 텍스트 — 제품 아래 빈 공간 채우기
    text_lines = [l for l in lines if l.strip()]
    y_mid = max(prod_bottom + 48, 990)
    for i, line in enumerate(text_lines[:2]):
        if y_mid + i * 130 > H - 360:
            break
        font = font_hero if i == 0 else font_main
        color = (255, 220, 50) if i == 0 else (255, 200, 200)
        draw.text((W // 2, y_mid + i * 130), line, font=font, anchor="ms",
                  fill=color, stroke_width=3, stroke_fill=(0, 0, 0))

    # 전체폭 CTA 버튼 (하단)
    btn_y1 = H - 295
    btn_y2 = H - 95
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ov).rounded_rectangle(
        [45, btn_y1, W - 45, btn_y2], radius=60, fill=(255, 80, 10, 245)
    )
    img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
    draw = ImageDraw.Draw(img)
    draw.text((W // 2, (btn_y1 + btn_y2) // 2 - 16), "🛒 설명란 링크 클릭",
              font=font_cta, anchor="mm", fill=(255, 255, 255),
              stroke_width=2, stroke_fill=(100, 30, 0))
    draw.text((W // 2, (btn_y1 + btn_y2) // 2 + 36), "쿠팡 최저가 확인하기",
              font=font_sub, anchor="mm", fill=(255, 220, 180))

    # 씬 카운터 4/4
    img = _draw_scene_counter(img, 3, font_badge)

    draw = ImageDraw.Draw(img)
    draw.rectangle([0, H - 8, W, H], fill=accent)
    return np.array(img.convert("RGB"))


def create_scene_image(
    display_text: list[str],
    bg_start: tuple,
    bg_end: tuple,
    accent_color: tuple = (255, 215, 50),
    scene_label: str = "",
    product_img_path: str | None = None,
    scene_idx: int = 0,
    product_name: str = "",
    scene_bg_path: str | None = None,
) -> np.ndarray:
    """씬별 독립 레이아웃 디스패처. scene_bg_path 있으면 FLUX 배경 우선 사용."""
    try:
        dispatch = [_scene0_hook, _scene1_showcase, _scene2_benefits, _scene3_cta]
        fn = dispatch[scene_idx] if scene_idx < len(dispatch) else dispatch[-1]
        return fn(display_text, product_img_path, product_name, accent_color, scene_bg=scene_bg_path)
    except Exception as e:
        import traceback
        print(f"[video_maker] 씬{scene_idx} 렌더 오류: {e}\n{traceback.format_exc()}", file=sys.stderr)
        arr = np.full((SIZE[1], SIZE[0], 3), [30, 20, 60], dtype=np.uint8)
        return arr


# ── BGM 준비 ─────────────────────────────────────────────────────────────────
def _ensure_bgm() -> str | None:
    """BGM 파일 확인. 없으면 무음 생성."""
    bgm = Path(BGM_PATH)
    if bgm.exists() and bgm.stat().st_size > 1000:
        return str(bgm)

    # imageio-ffmpeg에서 ffmpeg 경로 가져와 무음 생성
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        silent = str(ASSETS_DIR / "silence.mp3")
        subprocess.run([
            ffmpeg, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", "35", "-q:a", "9", "-acodec", "libmp3lame", silent, "-y"
        ], capture_output=True, timeout=30)
        if Path(silent).exists():
            return silent
    except Exception:
        pass
    return None


# ── 메인: 영상 생성 ───────────────────────────────────────────────────────────
def make_video(content_id: int) -> dict:
    """content_id → renders/{content_id}.mp4 생성."""
    output_path = RENDERS_DIR / f"{content_id}.mp4"

    # DB 조회
    row = db.query_one(
        """SELECT c.id, c.hook, c.script, c.platform,
                  p.name as product_name, p.category, p.coupang_url
           FROM content c JOIN products p ON c.product_id = p.id
           WHERE c.id = ?""",
        [content_id],
    )
    if not row:
        return {"ok": False, "error": f"content_id={content_id} 없음"}

    hook         = row.get("hook") or ""
    script       = row.get("script") or ""
    product_name = row.get("product_name") or "상품"
    category     = row.get("category") or "기타"
    coupang_url  = row.get("coupang_url") or "https://www.coupang.com"

    print(f"[video_maker] 영상 생성 시작: content_id={content_id} / {product_name}")

    # P0-B: temp_audiofile을 tmp_dir 밖으로 — finally cleanup 레이스 방지
    temp_audio = str(RENDERS_DIR / f"tmp_audio_{content_id}.m4a")
    tmp_dir = RENDERS_DIR / f"tmp_{content_id}"
    tmp_dir.mkdir(exist_ok=True)

    try:
        # 1. 시나리오 생성
        print("[video_maker] 시나리오 생성 중...")
        scenario = generate_scenario(hook, script, product_name, coupang_url)

        # 2. 제품 이미지 취득 (쿠팡 URL → Stability AI → 없음)
        product_img = str(tmp_dir / "product.jpg")
        has_img = fetch_coupang_image(coupang_url, product_img)
        if not has_img:
            has_img = generate_product_image(product_name, category, product_img)
        if not has_img:
            product_img = None

        # 3. TTS 생성
        print("[video_maker] TTS 생성 중...")
        tts_paths = []
        for i in range(1, 5):
            key = f"scene{i}"
            tts_text = scenario.get(key, {}).get("tts", "")
            tts_path = str(tmp_dir / f"tts_{i}.mp3")
            if tts_text and generate_tts(tts_text, tts_path):
                tts_paths.append(tts_path)
            else:
                tts_paths.append(None)

        # 4. FLUX 씬별 이미지 생성 (로컬 RTX 3060, 실패해도 PIL 폴백)
        flux_scene_paths = [None, None, None, None]
        try:
            from skills.image_generator import build_scene_prompts_via_ai, generate_scene_images
            print("[video_maker] FLUX 씬 이미지 생성 중 (RTX 3060)...")
            prompts = build_scene_prompts_via_ai(product_name, category, scenario)
            flux_dir = str(tmp_dir / "flux_scenes")
            flux_scene_paths = generate_scene_images(prompts, flux_dir)
            ok_count = sum(1 for p in flux_scene_paths if p)
            print(f"[video_maker] FLUX 완료: {ok_count}/4 씬 생성")
        except Exception as e:
            print(f"[video_maker] FLUX 생성 실패 (PIL 폴백): {e}", file=sys.stderr)

        # 5. 씬별 클립 생성
        print("[video_maker] 영상 클립 생성 중...")
        from moviepy import AudioFileClip, concatenate_videoclips

        _KEN_BURNS_EFFECTS = ["zoom_in", "pan_right", "zoom_out", "pan_left"]

        clips = []
        for i, (duration, bg_start, bg_end) in enumerate(SCENES_CONFIG):
            key = f"scene{i+1}"
            display_text = scenario.get(key, {}).get("display_text", [f"씬{i+1}"])
            flux_bg = flux_scene_paths[i] if i < len(flux_scene_paths) else None
            img_arr = create_scene_image(
                display_text, bg_start, bg_end,
                accent_color=SCENE_ACCENT_COLORS[i],
                scene_label=SCENE_LABELS[i],
                product_img_path=product_img,
                scene_idx=i,
                product_name=product_name,
                scene_bg_path=flux_bg,
            )
            # Ken Burns 효과 (FLUX 이미지 있을 때) or 정적 ImageClip
            if flux_bg:
                clip = _ken_burns_clip(img_arr, duration, _KEN_BURNS_EFFECTS[i])
                clip = clip.with_fps(30)
            else:
                from moviepy import ImageClip
                clip = ImageClip(img_arr, duration=duration)

            # 씬 전환 FadeIn/FadeOut (0.35s)
            try:
                from moviepy.video.fx import FadeIn, FadeOut
                clip = clip.with_effects([FadeIn(0.35), FadeOut(0.35)])
            except Exception:
                pass

            # TTS 오디오 설정
            tts_p = tts_paths[i] if i < len(tts_paths) else None
            if tts_p and Path(tts_p).exists():
                try:
                    audio = AudioFileClip(tts_p)
                    # Codex#8: duration None/0 가드
                    if audio.duration and audio.duration > 0:
                        audio_dur = min(audio.duration, duration)
                        clip = clip.with_audio(audio.subclipped(0, audio_dur))
                    else:
                        audio.close()
                except Exception as e:
                    print(f"[video_maker] 씬{i+1} 오디오 설정 실패: {e}", file=sys.stderr)

            clips.append(clip)

        # 6. 클립 연결
        final_video = concatenate_videoclips(clips, method="compose")

        # 7. 배경음악 믹싱 — Codex#1: 올바른 CompositeAudioClip 임포트
        bgm_path = _ensure_bgm()
        if bgm_path:
            try:
                from moviepy import CompositeAudioClip  # moviepy 2.x 공개 경로
                _bgm_raw = AudioFileClip(bgm_path)
                _bgm_dur = _bgm_raw.duration or 0
                # BGM이 영상보다 짧으면 자르지 않음 (subclipped 범위 초과 방지)
                _clip_end = min(TOTAL_DURATION, _bgm_dur) if _bgm_dur > 0 else TOTAL_DURATION
                bgm_clip = _bgm_raw.subclipped(0, _clip_end) if _bgm_dur > 0 else _bgm_raw
                bgm_clip = bgm_clip.with_volume_scaled(0.12)
                if final_video.audio is not None:
                    mixed = CompositeAudioClip([final_video.audio, bgm_clip])
                else:
                    mixed = bgm_clip
                final_video = final_video.with_audio(mixed)
            except Exception as e:
                print(f"[video_maker] BGM 믹싱 실패 (TTS만 사용): {e}", file=sys.stderr)

        # 8. MP4 저장 — CRF 18 품질 보장 (Codex#2: write 후 close)
        print(f"[video_maker] MP4 저장 중: {output_path}")
        final_video.write_videofile(
            str(output_path),
            fps=30,
            codec="libx264",
            audio_codec="aac",
            ffmpeg_params=["-crf", "18", "-preset", "fast"],
            temp_audiofile=temp_audio,
            logger=None,
        )
        final_video.close()

        # 9. DB 업데이트
        db.execute(
            "UPDATE content SET render_status='done', render_url=? WHERE id=?",
            [str(output_path), content_id],
        )

        size_mb = output_path.stat().st_size / 1024 / 1024
        print(f"[video_maker] 완료: {output_path} ({size_mb:.1f}MB)")

        # 10. 자동 QA
        qa_result = {}
        try:
            from skills.video_qa import run_qa, print_report
            sdxl_ok = sum(1 for p in flux_scene_paths if p)
            qa_result = run_qa(str(output_path), content_id=content_id,
                               sdxl_scene_count=sdxl_ok)
            print_report(qa_result)
            # QA 결과 DB 저장 (컬럼 없으면 무시)
            try:
                qa_json = json.dumps({
                    "score": qa_result["score"],
                    "ok": qa_result["ok"],
                    "warnings": qa_result["warnings"],
                }, ensure_ascii=False)
                db.execute(
                    "UPDATE content SET qa_result=? WHERE id=?",
                    [qa_json, content_id],
                )
            except Exception:
                pass  # qa_result 컬럼 없어도 무시
        except Exception as e:
            print(f"[video_maker] QA 실패 (무시): {e}", file=sys.stderr)

        return {
            "ok": True,
            "content_id": content_id,
            "mp4_path": str(output_path),
            "size_mb": round(size_mb, 1),
            "qa_score": qa_result.get("score", -1),
            "qa_ok": qa_result.get("ok", None),
            "qa_warnings": qa_result.get("warnings", []),
            "qa_dir": qa_result.get("qa_dir", ""),
            "summary": f"영상 생성 완료: {product_name} ({size_mb:.1f}MB) | QA {qa_result.get('score', '?')}/100",
        }

    except Exception as e:
        import traceback
        print(f"[video_maker] 오류:\n{traceback.format_exc()}", file=sys.stderr)
        return {"ok": False, "error": str(e)}
    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)
        Path(temp_audio).unlink(missing_ok=True)


if __name__ == "__main__":
    cid = int(sys.argv[1]) if len(sys.argv) > 1 else 607
    result = make_video(cid)
    print(json.dumps(result, ensure_ascii=False, indent=2))
