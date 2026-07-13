"""Free local FFmpeg renderer. Run with: python scripts/free-video-worker.py"""
import json, os, subprocess, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1] / "data" / "local-renders"; ROOT.mkdir(parents=True, exist_ok=True)
TOKEN = os.getenv("LOCAL_RENDER_TOKEN", ""); FONT = "C:/Windows/Fonts/malgun.ttf"

def render(body):
    rid = "local-" + uuid.uuid4().hex[:12]; folder = ROOT / rid; folder.mkdir()
    (folder / "title.txt").write_text(str(body.get("title") or body.get("productName") or "추천 상품")[:42], encoding="utf-8")
    (folder / "script.txt").write_text(str(body.get("script") or body.get("hook") or "상품 정보를 확인하세요")[:180], encoding="utf-8")
    def fp(p): return str(p).replace("\\", "/").replace(":", "\\:")
    vf = f"drawtext=fontfile='{fp(FONT)}':textfile='{fp(folder/'title.txt')}':fontcolor=white:fontsize=72:x=80:y=500,drawtext=fontfile='{fp(FONT)}':text='오늘의 쇼츠 추천':fontcolor=0x78e6cd:fontsize=34:x=80:y=300,drawtext=fontfile='{fp(FONT)}':textfile='{fp(folder/'script.txt')}':fontcolor=0xdce6f5:fontsize=46:x=80:y=900"
    frame = folder / "frame.png"; out = folder / "video.mp4"; audio = folder / "narration.wav"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=0x121828:s=1080x1920", "-frames:v", "1", "-vf", vf, str(frame)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tts_url, tts_token = os.getenv("LOCAL_TTS_URL", ""), os.getenv("LOCAL_TTS_TOKEN", "")
    if tts_url and tts_token:
        req = Request(tts_url.rstrip("/") + "/synthesize", data=json.dumps({"text": (folder / "script.txt").read_text(encoding="utf-8")}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + tts_token}, method="POST")
        with urlopen(req, timeout=45) as response: audio.write_bytes(response.read())
    video = ["ffmpeg", "-y", "-loop", "1", "-i", str(frame)]
    if audio.exists(): video += ["-i", str(audio)]
    video += ["-t", "15"]
    video += ["-vf", "format=yuv420p", "-r", "30", "-c:v", "libx264", "-b:v", "1000k", "-minrate", "1000k", "-maxrate", "1000k", "-bufsize", "2000k", "-c:a", "aac", "-movflags", "+faststart", str(out)]
    subprocess.run(video, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return rid

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/render" or (TOKEN and self.headers.get("authorization") != "Bearer " + TOKEN): self.send_error(401); return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0)))); rid = render(body)
        base = os.getenv("LOCAL_RENDER_PUBLIC_URL", "http://127.0.0.1:8770"); data = json.dumps({"id": rid, "videoUrl": base.rstrip("/") + "/files/" + rid + ".mp4"}).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        p = ROOT / self.path[7:-4] / "video.mp4" if self.path.startswith("/files/") and self.path.endswith(".mp4") else None
        if p and p.exists(): self.send_response(200); self.send_header("content-type", "video/mp4"); self.end_headers(); self.wfile.write(p.read_bytes()); return
        self.send_error(404)

ThreadingHTTPServer(("0.0.0.0", 8770), Handler).serve_forever()
