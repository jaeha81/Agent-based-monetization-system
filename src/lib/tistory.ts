const API = 'https://www.tistory.com/apis'

export async function postTistory(
  title: string,
  content: string,
  tags: string[],
): Promise<{ postId: string; url: string }> {
  const token = process.env.TISTORY_ACCESS_TOKEN
  const blogName = process.env.TISTORY_BLOG_NAME
  if (!token || !blogName) throw new Error('TISTORY_ACCESS_TOKEN / TISTORY_BLOG_NAME 미설정')

  const params = new URLSearchParams({
    access_token: token,
    output: 'json',
    blogName,
    title,
    content,
    visibility: '3',
    tag: tags.slice(0, 10).join(','),
  })

  const res = await fetch(`${API}/post/write?${params}`, { method: 'POST' })
  if (!res.ok) throw new Error(`Tistory 포스팅 실패: ${await res.text()}`)

  const data = await res.json() as { tistory: { status: string; postId: string; url: string } }
  if (data.tistory?.status !== '200') throw new Error(`Tistory 오류: ${JSON.stringify(data.tistory)}`)

  return { postId: data.tistory.postId, url: data.tistory.url }
}

export function buildTistoryContent(
  hook: string,
  script: string,
  productName: string,
  affiliateUrl: string,
  tags: string[],
  disclosure: string,
): string {
  return `
<h2 style="color:#e74c3c">⚡ ${hook}</h2>

<blockquote><strong>${productName}</strong></blockquote>

<p>${script.replace(/\n/g, '<br>')}</p>

<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:16px;margin:24px 0;border-radius:4px">
  <strong>💰 지금 최저가 확인하기</strong><br>
  <a href="${affiliateUrl}" target="_blank" rel="noopener sponsored"
    style="display:inline-block;margin-top:8px;padding:12px 24px;
    background:#e74c3c;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold">
    👉 ${productName} 구매하러 가기
  </a>
</div>

<p style="font-size:12px;color:#888">${disclosure}</p>

<p>${tags.map(t => `#${t}`).join(' ')}</p>
`.trim()
}
