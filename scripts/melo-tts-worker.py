"""Free commercial Korean TTS worker for shorts-dashboard.

Run on an always-on Windows PC. The Next.js /api/tts route calls this worker
when GOOGLE_TTS_API_KEY is not configured.
"""

import io
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from melo.api import TTS

HOST = os.getenv("LOCAL_TTS_HOST", "127.0.0.1")
PORT = int(os.getenv("LOCAL_TTS_PORT", "8766"))
TOKEN = os.getenv("LOCAL_TTS_TOKEN", "")
MODEL = TTS(language="KR", device=os.getenv("MELO_DEVICE", "cpu"))
SPEAKER = MODEL.hps.data.spk2id["KR"]


def authorized(handler: BaseHTTPRequestHandler) -> bool:
    if not TOKEN:
        return False
    provided = handler.headers.get("Authorization", "")
    return secrets.compare_digest(provided, f"Bearer {TOKEN}")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        if not authorized(self):
            self.send_error(401)
            return
        body = json.dumps({"ok": True, "provider": "MeloTTS", "language": "ko"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return
        if not authorized(self):
            self.send_error(401)
            return
        try:
            size = min(int(self.headers.get("Content-Length", "0")), 20_000)
            payload = json.loads(self.rfile.read(size))
            text = str(payload.get("text", "")).strip()[:500]
            if not text:
                self.send_error(400, "text is required")
                return
            output = io.BytesIO()
            MODEL.tts_to_file(text, SPEAKER, output, speed=1.0, format="wav", quiet=True)
            audio = output.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(audio)
        except Exception as exc:
            self.send_error(500, str(exc)[:120])

    def log_message(self, fmt, *args):
        print(f"[MeloTTS] {self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("LOCAL_TTS_TOKEN must be set")
    print(f"MeloTTS worker listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
