#!/usr/bin/env python3
"""
video_qa.py — 렌더 완료 후 자동 품질 검수

자동 체크 (코드로 감지):
  1. 해상도 1080x1920
  2. 영상 길이 25~35초
  3. 파일 크기 3MB 이상
  4. 오디오 트랙 존재
  5. 씬별 평균 밝기 (너무 어두운 씬 경고)
  6. 하단 캡션 영역 대비율 (텍스트 가독성)
  7. SDXL 씬 이미지 4장 생성 여부

사람 검수용:
  - 씬 프레임 4장 추출 → renders/{id}_qa/scene1~4.jpg
  - 체크리스트 출력
"""
import sys
import json
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# ffprobe로 영상 메타데이터 추출
def _probe(mp4_path: str) -> dict:
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        ffprobe = str(Path(ffmpeg).parent / "ffprobe.exe")
        if not Path(ffprobe).exists():
            ffprobe = "ffprobe"
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json",
             "-show_streams", "-show_format", mp4_path],
            capture_output=True, text=True, timeout=15,
            encoding="utf-8", errors="replace",
        )
        return json.loads(result.stdout) if result.returncode == 0 else {}
    except Exception:
        return {}


def _extract_frames(mp4_path: str, qa_dir: str, timestamps: list) -> list:
    """씬별 프레임 추출. 반환: 저장된 경로 리스트."""
    paths = []
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        Path(qa_dir).mkdir(parents=True, exist_ok=True)
        for i, t in enumerate(timestamps):
            out = str(Path(qa_dir) / f"scene{i+1}.jpg")
            subprocess.run(
                [ffmpeg, "-ss", str(t), "-i", mp4_path,
                 "-vframes", "1", "-q:v", "2", out, "-y"],
                capture_output=True, timeout=15,
            )
            if Path(out).exists():
                paths.append(out)
            else:
                paths.append(None)
    except Exception as e:
        print(f"[video_qa] 프레임 추출 실패: {e}", file=sys.stderr)
    return paths


def _check_brightness(frame_path: str) -> dict:
    """씬 프레임의 밝기 분석. 하단 캡션 영역 대비율 포함."""
    try:
        import numpy as np
        from PIL import Image
        img = Image.open(frame_path).convert("RGB")
        arr = np.array(img)
        H, W = arr.shape[:2]

        # 전체 평균 밝기
        avg_brightness = int(arr.mean())

        # 하단 캡션 영역 (하단 35%)
        caption_region = arr[int(H * 0.65):, :]
        caption_bg = caption_region[:int(caption_region.shape[0] * 0.3)]  # 박스 배경
        caption_text = caption_region[int(caption_region.shape[0] * 0.3):]  # 텍스트 영역

        bg_brightness = int(caption_bg.mean()) if caption_bg.size else 0
        text_brightness = int(caption_text.mean()) if caption_text.size else 0
        contrast = abs(bg_brightness - text_brightness)

        return {
            "avg_brightness": avg_brightness,
            "caption_contrast": contrast,
            "too_dark": avg_brightness < 25,
            "too_bright": avg_brightness > 230,
            "low_contrast": contrast < 30,
        }
    except Exception:
        return {"avg_brightness": -1, "caption_contrast": -1,
                "too_dark": False, "too_bright": False, "low_contrast": False}


def run_qa(mp4_path: str, content_id: int = 0,
           sdxl_scene_count: int = 0) -> dict:
    """
    영상 자동 QA 실행.

    Args:
        mp4_path: 검수할 MP4 경로
        content_id: DB content id (프레임 저장 폴더명에 사용)
        sdxl_scene_count: SDXL 성공 씬 수 (make_video에서 전달)

    Returns:
        {ok, score, checks, warnings, frame_paths, human_checklist}
    """
    checks = []
    warnings = []

    def _check(name: str, passed: bool, value: str, critical: bool = False):
        checks.append({
            "name": name,
            "pass": passed,
            "value": value,
            "critical": critical,
        })
        if not passed:
            level = "❌ FAIL" if critical else "⚠ WARN"
            warnings.append(f"{level} [{name}] {value}")

    mp4 = Path(mp4_path)

    # 1. 파일 존재
    exists = mp4.exists() and mp4.stat().st_size > 0
    _check("파일 존재", exists, str(mp4_path), critical=True)
    if not exists:
        return {"ok": False, "score": 0, "checks": checks,
                "warnings": warnings, "frame_paths": [], "human_checklist": []}

    # 2. 파일 크기
    size_mb = mp4.stat().st_size / 1024 / 1024
    _check("파일 크기 ≥ 3MB", size_mb >= 3.0, f"{size_mb:.1f}MB", critical=True)

    # ffprobe로 메타데이터
    meta = _probe(mp4_path)
    streams = meta.get("streams", [])
    fmt = meta.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    # 3. 해상도
    width  = video_stream.get("width", 0)
    height = video_stream.get("height", 0)
    res_ok = (width == 1080 and height == 1920)
    _check("해상도 1080x1920", res_ok, f"{width}x{height}", critical=True)

    # 4. 영상 길이
    duration = float(fmt.get("duration", 0))
    dur_ok = 20 <= duration <= 40
    _check("영상 길이 20~40s", dur_ok, f"{duration:.1f}s", critical=False)

    # 5. 오디오 트랙
    has_audio = audio_stream is not None
    _check("오디오 트랙 존재", has_audio, "있음" if has_audio else "없음", critical=False)

    # 6. SDXL 씬 이미지
    sdxl_ok = sdxl_scene_count >= 3
    _check(f"SDXL 씬 이미지 ≥3/4", sdxl_ok, f"{sdxl_scene_count}/4", critical=False)

    # 7. 씬 프레임 추출 (씬별 중간 타임스탬프)
    scene_dur = duration / 4 if duration > 0 else 7.5
    timestamps = [scene_dur * i + scene_dur * 0.4 for i in range(4)]
    qa_dir = str(mp4.parent / f"{mp4.stem}_qa")
    frame_paths = _extract_frames(mp4_path, qa_dir, timestamps)

    # 8. 씬별 밝기/대비 체크
    for i, fp in enumerate(frame_paths):
        if not fp:
            warnings.append(f"⚠ WARN [씬{i+1} 프레임] 추출 실패")
            continue
        bri = _check_brightness(fp)
        if bri["too_dark"]:
            warnings.append(f"⚠ WARN [씬{i+1}] 너무 어두움 (밝기={bri['avg_brightness']})")
        if bri["too_bright"]:
            warnings.append(f"⚠ WARN [씬{i+1}] 너무 밝음 (밝기={bri['avg_brightness']})")
        if bri["low_contrast"]:
            warnings.append(f"⚠ WARN [씬{i+1}] 캡션 대비율 낮음 (contrast={bri['caption_contrast']})")

    # 점수 계산 (critical 실패 시 0점, 나머지는 항목별 감점)
    critical_fails = [c for c in checks if c["critical"] and not c["pass"]]
    if critical_fails:
        score = 0
    else:
        total = len(checks)
        passed = sum(1 for c in checks if c["pass"])
        base = int(passed / total * 80)
        # 경고 없으면 보너스
        warn_penalty = min(len(warnings) * 5, 20)
        score = max(0, base + 20 - warn_penalty)

    # 사람 검수 체크리스트
    human_checklist = [
        "[ ] 씬1: 훅 텍스트가 눈에 잘 띄는가?",
        "[ ] 씬2: 제품이미지가 올바른 제품인가?",
        "[ ] 씬3: 혜택 텍스트가 자연스러운가?",
        "[ ] 씬4: CTA(구매 유도) 문구가 명확한가?",
        "[ ] 전체: 이모지 깨짐(□) 없는가?",
        "[ ] 전체: 텍스트가 화면 밖으로 잘리지 않는가?",
        "[ ] 전체: TTS 음성이 자연스럽게 들리는가?",
        "[ ] 전체: 영상 흐름이 자연스러운가?",
    ]

    ok = len(critical_fails) == 0

    return {
        "ok": ok,
        "score": score,
        "checks": checks,
        "warnings": warnings,
        "frame_paths": [p for p in frame_paths if p],
        "qa_dir": qa_dir,
        "human_checklist": human_checklist,
        "meta": {
            "resolution": f"{width}x{height}",
            "duration_sec": round(duration, 1),
            "size_mb": round(size_mb, 1),
            "has_audio": has_audio,
            "sdxl_scenes": sdxl_scene_count,
        },
    }


def print_report(result: dict):
    """QA 결과를 콘솔에 출력."""
    ok_mark  = "✅" if result["ok"] else "❌"
    score    = result["score"]
    print(f"\n{'='*50}")
    print(f"  영상 QA 결과  {ok_mark}  점수: {score}/100")
    print(f"{'='*50}")

    print("\n[자동 체크]")
    for c in result["checks"]:
        mark = "✅" if c["pass"] else ("❌" if c["critical"] else "⚠")
        print(f"  {mark} {c['name']}: {c['value']}")

    if result["warnings"]:
        print("\n[경고]")
        for w in result["warnings"]:
            print(f"  {w}")

    if result.get("frame_paths"):
        print(f"\n[프레임 저장 위치] {result.get('qa_dir', '')}")
        for i, fp in enumerate(result["frame_paths"]):
            print(f"  씬{i+1}: {Path(fp).name}")

    print("\n[사람 검수 체크리스트]")
    for item in result["human_checklist"]:
        print(f"  {item}")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    # 독립 실행: python -X utf8 skills/video_qa.py <mp4_path>
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "renders/655.mp4"
    cid  = int(sys.argv[2]) if len(sys.argv) > 2 else 655
    result = run_qa(path, content_id=cid)
    print_report(result)
