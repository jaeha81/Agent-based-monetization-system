#!/usr/bin/env python3
"""솔로 테니스 리바운더 YouTube Shorts 콘텐츠 생성"""
import sys, json, time, urllib.request, urllib.error
sys.path.insert(0, '.')
import config

PROMPT = """당신은 한국 유튜브 쇼츠 전문 마케터입니다.

상품: 솔로 테니스 리바운더 (혼자 치는 테니스 훈련기구)
쿠팡 파트너스 링크: https://link.coupang.com/a/AF5520196?url=https%3A%2F%2Fwww.coupang.com%2Fnp%2Fsearch%3Fq%3D%EC%86%94%EB%A1%9C%2B%ED%85%8C%EB%8B%88%EC%8A%A4

아래 4가지를 생성하세요:

1. 제목 (60자 이내, SEO 최적화, 클릭 유도)
2. 훅 스크립트 (0-3초, 15자 이내, 심리적 트리거)
3. 본문 스크립트 (30초 쇼츠, 200자 내외):
   - 0-3초: 훅
   - 3-10초: 문제 제기 (파트너 없어서 못 치는 상황)
   - 10-25초: 해결책 (리바운더 구체적 혜택)
   - 25-30초: CTA (링크 클릭 유도, 희소성)
4. 해시태그 (10개, #광고 #쿠팡파트너스 포함)
5. 설명란 텍스트 (링크 포함, 200자)

JSON으로만 응답:
{
  "title": "제목",
  "hook": "훅 (15자 이내)",
  "script": "전체 스크립트",
  "hashtags": "#태그1 #태그2...",
  "description": "설명란 텍스트 (링크 포함)"
}"""

url = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"gemini-2.5-flash:generateContent?key={config.GEMINI_API_KEY}"
)
body = json.dumps({
    "contents": [{"parts": [{"text": PROMPT}]}],
    "generationConfig": {"temperature": 0.8, "maxOutputTokens": 2048},
}).encode()

for attempt in range(2):
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        # JSON 추출
        start = text.find("{")
        end = text.rfind("}") + 1
        result = json.loads(text[start:end])
        print("=" * 60)
        print("【YouTube Shorts 업로드 패킷】")
        print("=" * 60)
        print(f"\n📌 제목:\n{result['title']}")
        print(f"\n🎬 훅 (0-3초):\n{result['hook']}")
        print(f"\n📝 스크립트:\n{result['script']}")
        print(f"\n#️⃣ 해시태그:\n{result['hashtags']}")
        print(f"\n📄 설명란:\n{result['description']}")
        break
    except urllib.error.HTTPError as e:
        if e.code == 429 and attempt == 0:
            print("⏳ 429 rate limit — 35초 대기 후 재시도...")
            time.sleep(35)
            continue
        print(f"오류: {e.code} {e.read().decode()}")
        break
