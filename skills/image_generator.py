#!/usr/bin/env python3
"""
image_generator.py — FLUX.1-schnell 로컬 이미지 생성
RTX 3060 8GB + diffusers (이미 설치됨) 활용, API 비용 없음
"""
import sys
import json
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config

_pipe = None
_pipe_loaded = False


def _get_pipeline():
    """SDXL 파이프라인 로드 (최초 1회, 이후 캐시). 비게이트, 완전 무료."""
    import torch
    from diffusers import StableDiffusionXLPipeline

    print("[image_gen] SDXL 로드 중 (최초 실행 시 ~6.5GB 다운로드)...")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        torch_dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
    )
    pipe.enable_model_cpu_offload()  # RTX 3060 8GB VRAM 최적화
    print("[image_gen] 파이프라인 준비 완료")
    return pipe


# 씬별 기본 이미지 프롬프트 (Claude CLI 실패 시 폴백)
_DEFAULT_SCENE_PROMPTS = [
    "dramatic product reveal, dark moody background, cinematic spotlight, "
    "mysterious and intriguing, vertical 9:16 composition",
    "professional product photography, pure white studio background, "
    "clean minimal aesthetic, sharp focus, commercial quality, vertical 9:16",
    "lifestyle scene, natural warm lighting, product in daily use, "
    "cozy home environment, relatable everyday moment, vertical 9:16",
    "close-up product detail, vibrant saturated colors, "
    "shopping urgency feeling, purchase motivation, vertical 9:16",
]

_SCENE_STYLE_HINTS = [
    "dark dramatic cinematic, spotlight effect, mysterious reveal",
    "white background studio, minimal clean, sharp commercial photography",
    "warm natural lifestyle, home environment, in-use scene",
    "close-up detail, vivid colors, urgency, purchase now",
]


def build_scene_prompts_via_ai(product_name: str, category: str,
                                scenario: dict) -> list:
    """Claude CLI로 씬별 최적화 이미지 프롬프트 4개 생성."""
    prompts_from_scenario = [
        scenario.get(f"scene{i+1}", {}).get("image_prompt", "")
        for i in range(4)
    ]
    # 시나리오에 이미 있으면 그대로 사용
    if all(p.strip() for p in prompts_from_scenario):
        return prompts_from_scenario

    # Claude CLI로 생성
    prompt = f"""You are a professional AI image prompt engineer for vertical (9:16) short-form video.
Generate 4 scene-specific image prompts for a Korean shopping shorts video.

Product: {product_name}
Category: {category}

Scene requirements:
- Scene 1 (Hook): Mysterious/dramatic reveal. Dark moody background. Viewer should be curious.
- Scene 2 (Showcase): Clean studio product shot. White/light background. Professional.
- Scene 3 (Benefits): Lifestyle/in-use. Warm natural light. Relatable everyday setting.
- Scene 4 (CTA): Close-up detail or urgency visual. Vivid colors. Purchase motivation.

Rules:
- English prompts only
- Each prompt: 1-2 sentences, very descriptive
- Include "vertical 9:16 composition" in each
- Focus on lighting, mood, setting — not text
- Do NOT include people's faces (copyright/privacy)

Output JSON only:
{{"scene1": "prompt...", "scene2": "prompt...", "scene3": "prompt...", "scene4": "prompt..."}}"""

    try:
        result = subprocess.run(
            [config.CLAUDE_CMD, "--print"],
            input=prompt, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=90,
        )
        if result.returncode == 0 and result.stdout.strip():
            raw = result.stdout.strip()
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0:
                data = json.loads(raw[start:end])
                return [
                    data.get("scene1", ""),
                    data.get("scene2", ""),
                    data.get("scene3", ""),
                    data.get("scene4", ""),
                ]
    except Exception as e:
        print(f"[image_gen] Claude CLI 프롬프트 생성 실패: {e}", file=sys.stderr)

    # 폴백: 기본 프롬프트 + 제품명 삽입
    hint = next((v for k, v in {
        "유아": "baby product, infant care item",
        "스포츠": "sports equipment, fitness gear",
        "뷰티": "beauty cosmetics, skincare",
        "주방": "kitchen appliance, cooking tool",
        "전자": "consumer electronics, gadget",
        "생활": "household item, home goods",
        "식품": "premium food product",
        "패션": "fashion accessory",
    }.items() if k in category), "consumer product")

    return [
        f"{product_name}, {hint}, {_DEFAULT_SCENE_PROMPTS[0]}, {_SCENE_STYLE_HINTS[0]}",
        f"{product_name}, {hint}, {_DEFAULT_SCENE_PROMPTS[1]}, {_SCENE_STYLE_HINTS[1]}",
        f"{product_name}, {hint}, {_DEFAULT_SCENE_PROMPTS[2]}, {_SCENE_STYLE_HINTS[2]}",
        f"{product_name}, {hint}, {_DEFAULT_SCENE_PROMPTS[3]}, {_SCENE_STYLE_HINTS[3]}",
    ]


def generate_scene_images(prompts: list, out_dir: str) -> list:
    """FLUX.1-schnell으로 씬별 이미지 4장 생성.

    Args:
        prompts: 씬별 영문 프롬프트 list (최대 4개)
        out_dir: 저장 디렉토리 경로

    Returns:
        저장된 파일 경로 list (생성 실패 시 None)
    """
    import torch
    from PIL import Image

    global _pipe, _pipe_loaded
    if not _pipe_loaded:
        _pipe = _get_pipeline()
        _pipe_loaded = True

    out_path = Path(out_dir)
    out_path.mkdir(exist_ok=True, parents=True)

    paths = []
    for i, prompt in enumerate(prompts[:4]):
        out_file = str(out_path / f"scene_img_{i + 1}.jpg")
        if not prompt or not prompt.strip():
            print(f"[image_gen] 씬{i+1} 프롬프트 없음 → 건너뜀", file=sys.stderr)
            paths.append(None)
            continue

        print(f"[image_gen] 씬{i+1} 생성 중...")
        try:
            result = _pipe(
                prompt=prompt,
                width=768,
                height=1344,           # SDXL 9:16 최적 해상도 → 1080x1920으로 업스케일
                num_inference_steps=20, # SDXL 권장 스텝
                guidance_scale=7.5,
                generator=torch.Generator("cpu").manual_seed(42 + i),
            ).images[0]

            # 1080x1920 업스케일
            result = result.resize((1080, 1920), resample=Image.LANCZOS)
            result.save(out_file, "JPEG", quality=92)
            print(f"[image_gen] 씬{i+1} 완료: {Path(out_file).name}")
            paths.append(out_file)

        except Exception as e:
            print(f"[image_gen] 씬{i+1} 실패: {e}", file=sys.stderr)
            paths.append(None)

    return paths


if __name__ == "__main__":
    # 독립 테스트 (SDXL)
    test_prompts = [
        "LED light bulb, dramatic dark background with spotlight effect, "
        "mysterious product reveal, warm glowing light, cinematic mood, "
        "photorealistic, 8k quality, vertical 9:16 composition",
        "single LED light bulb on pure white studio background, "
        "professional product photography, minimal clean aesthetic, sharp focus, "
        "photorealistic, commercial quality, vertical 9:16 composition",
        "cozy modern living room illuminated by warm LED lighting at night, "
        "energy efficient home atmosphere, lifestyle photography, "
        "photorealistic, vertical 9:16 composition",
        "close-up of LED light bulb filament detail, vibrant vivid colors, "
        "shopping urgency visual, purchase motivation, photorealistic, vertical 9:16 composition",
    ]
    out = str(Path(__file__).parent.parent / "renders" / "tmp_test")
    print(f"테스트 이미지 저장 위치: {out}")
    results = generate_scene_images(test_prompts, out)
    for i, p in enumerate(results):
        status = "✅" if p else "❌"
        print(f"  씬{i+1}: {status} {p or '실패'}")
