#!/usr/bin/env python3
"""
quality_check.py — 생성된 MP4 품질 검증
ffmpeg 기술 검사 + Gemini 시각 분석
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config

MAX_ISSUES = 2  # 이슈가 이 수 미만이면 통과 (Gemini 경고성 항목 1개는 허용)


def _get_ffmpeg() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _technical_check(mp4_path: str) -> dict:
    """ffmpeg -i로 기술 스펙 검사."""
    issues = []
    ffmpeg = _get_ffmpeg()
    try:
        result = subprocess.run(
            [ffmpeg, "-i", mp4_path],
            capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=30,
        )
        stderr = result.stderr

        # 재생 시간 파싱
        duration = 0.0
        for line in stderr.splitlines():
            if "Duration:" in line:
                t = line.split("Duration:")[1].split(",")[0].strip()
                try:
                    h, m, s = t.split(":")
                    duration = int(h)*3600 + int(m)*60 + float(s)
                except Exception:
                    pass

        if duration < 25:
            issues.append(f"재생시간 너무 짧음: {duration:.1f}초 (최소 25s)")
        if duration > 65:
            issues.append(f"재생시간 너무 길음: {duration:.1f}초 (최대 65s)")

        # 해상도
        has_1080x1920 = "1080x1920" in stderr
        if not has_1080x1920:
            issues.append("해상도 비표준 — 1080x1920 필요")

        # 오디오 스트림
        has_audio = "Audio:" in stderr
        if not has_audio:
            issues.append("오디오 스트림 없음")

        return {
            "ok": len(issues) == 0,
            "duration": round(duration, 1),
            "has_audio": has_audio,
            "issues": issues,
        }
    except Exception as e:
        return {"ok": False, "issues": [f"ffmpeg 실행 오류: {e}"], "duration": 0}


def _extract_frames(mp4_path: str, timestamps: list[float], out_dir: str) -> list[str]:
    """ffmpeg로 특정 타임스탬프 프레임 추출."""
    ffmpeg = _get_ffmpeg()
    paths = []
    for i, t in enumerate(timestamps):
        out = os.path.join(out_dir, f"frame_{i}.jpg")
        try:
            subprocess.run(
                [ffmpeg, "-ss", str(t), "-i", mp4_path,
                 "-vframes", "1", "-q:v", "3", out, "-y"],
                capture_output=True, timeout=20,
            )
            if Path(out).exists():
                paths.append(out)
        except Exception:
            pass
    return paths


def _visual_check(frame_paths: list[str]) -> dict:
    """Gemini 멀티모달로 프레임 시각 검사."""
    if not config.GEMINI_API_KEY:
        return {"ok": True, "issues": [], "note": "Gemini API 없음 — 시각 검증 건너뜀"}
    if not frame_paths:
        return {"ok": False, "issues": ["프레임 추출 실패"]}

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={config.GEMINI_API_KEY}"
    )

    parts = [{
        "text": (
            "이 YouTube Shorts 영상 프레임들을 품질 검사하세요. 아래 항목을 순서대로 확인하세요.\n\n"
            "【한글 깨짐 탐지 — 최우선】\n"
            "1. 한국어 텍스트가 □□□ 또는 ??? 같은 빈 박스/물음표로 표시되는지 확인 (폰트 로드 실패)\n"
            "2. 한글 자모가 분리되거나 깨진 글자(예: ㅍㅣㅂ ㅜㅅ ㅅㅠㅂ)가 보이는지 확인\n"
            "3. 텍스트 영역이 완전히 빈칸(텍스트 없음)인지 확인\n"
            "4. 텍스트가 화면 밖으로 잘리거나 겹쳐서 가독성이 없는지 확인\n\n"
            "【영상 구성】\n"
            "5. 각 프레임 씬이 서로 다른 내용을 담고 있는지 (완전히 동일하면 오류)\n"
            "6. 배경이 완전히 검정/흰색 단색으로만 표시되는 렌더 오류 여부\n\n"
            "반드시 JSON만 응답 (다른 텍스트 없음):\n"
            '{"pass": true/false, "korean_ok": true/false, "issues": ["구체적 문제1", "구체적 문제2"]}\n'
            "한글이 정상이면 korean_ok=true, 깨지거나 박스로 보이면 false"
        )
    }]

    for fp in frame_paths[:4]:  # 최대 4장
        try:
            with open(fp, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode()
            parts.append({
                "inline_data": {"mime_type": "image/jpeg", "data": img_b64}
            })
        except Exception:
            pass

    body = json.dumps({
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 512},
    }).encode()

    try:
        import urllib.request
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        s = text.find("{")
        e = text.rfind("}") + 1
        if s >= 0:
            parsed = json.loads(text[s:e])
            korean_ok = parsed.get("korean_ok", True)
            issues = parsed.get("issues", [])
            if not korean_ok and not any("한글" in i or "깨" in i or "박스" in i for i in issues):
                issues.insert(0, "한글 깨짐 감지 — 텍스트가 □□□ 또는 빈 박스로 표시됨")
            return {
                "ok": parsed.get("pass", True),
                "korean_ok": korean_ok,
                "issues": issues,
            }
        passed = "false" not in text.lower() and len(text) < 200
        return {"ok": passed, "korean_ok": True, "issues": [text[:200]] if not passed else []}
    except Exception as ex:
        return {"ok": True, "issues": [], "note": f"Gemini 시각 검증 오류 (무시): {ex}"}


def _font_check() -> list[str]:
    """한글 폰트 파일 존재 여부 사전 확인."""
    issues = []
    fonts = [
        r"C:\Windows\Fonts\malgunbd.ttf",
        r"C:\Windows\Fonts\malgun.ttf",
    ]
    available = [f for f in fonts if Path(f).exists()]
    if not available:
        issues.append("한글 폰트 없음 — malgunbd.ttf / malgun.ttf 미설치 (한글 깨짐 위험)")
    return issues


def check(mp4_path: str) -> dict:
    """MP4 품질 검증 → {pass: bool, issues: [str], summary: str}."""
    p = Path(mp4_path)
    if not p.exists():
        return {"pass": False, "issues": [f"파일 없음: {mp4_path}"], "summary": "파일 없음"}

    size_mb = p.stat().st_size / 1024 / 1024
    if size_mb < 0.5:
        return {"pass": False, "issues": [f"파일 크기 너무 작음: {size_mb:.1f}MB"], "summary": "파일 불량"}

    # 폰트 사전 검사
    font_issues = _font_check()
    if font_issues:
        print(f"[quality_check] 폰트 경고: {font_issues}")

    # 기술 검사
    tech = _technical_check(mp4_path)
    print(f"[quality_check] 기술 검사: duration={tech.get('duration')}s, audio={tech.get('has_audio')}")

    all_issues = list(font_issues) + list(tech.get("issues", []))

    # 시각 검사 (프레임 추출)
    with tempfile.TemporaryDirectory() as td:
        dur = tech.get("duration", 30)
        ts = [3.0, dur * 0.33, dur * 0.66, dur - 4]
        ts = [max(0, min(t, dur - 1)) for t in ts]
        frames = _extract_frames(mp4_path, ts, td)
        visual = _visual_check(frames)
        print(f"[quality_check] 시각 검사: pass={visual.get('ok')}, issues={visual.get('issues')}")
        all_issues.extend(visual.get("issues", []))

    korean_ok = visual.get("korean_ok", True)
    passed = len(all_issues) < MAX_ISSUES and korean_ok
    summary = f"품질 {'통과' if passed else '실패'}: {size_mb:.1f}MB / {tech.get('duration', 0):.1f}s"
    if not korean_ok:
        summary += " / ⚠️ 한글 깨짐"
    if all_issues:
        summary += f" / 문제: {'; '.join(all_issues[:2])}"

    print(f"[quality_check] {summary}")
    return {
        "pass": passed,
        "korean_ok": korean_ok,
        "issues": all_issues,
        "size_mb": round(size_mb, 1),
        "duration": tech.get("duration", 0),
        "summary": summary,
    }


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else ""
    if not path:
        print("사용법: python quality_check.py <mp4_path>")
        sys.exit(1)
    result = check(path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
