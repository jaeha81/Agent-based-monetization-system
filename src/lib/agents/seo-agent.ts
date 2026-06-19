import { USE_MOCK, mockDelay, generateJSON } from '@/lib/claude-client'

const SYSTEM_PROMPT = `당신은 글로벌 소셜미디어 SEO 전문가입니다. 각 플랫폼의 알고리즘과 검색 최적화에 정통합니다.

플랫폼별 SEO 전략:
- YouTube: 제목 키워드 (앞 3단어 중요), 설명 첫 2줄에 키워드, 태그 15개 최적화
- Instagram: 해시태그 30개 믹스 (대형/중형/소형 버킷), 위치 태그, 저장 유도 문구
- TikTok: 사운드 트렌드 태그, Stitch/Duet 유도, 챌린지 해시태그
- Naver: 검색 키워드 제목 포함, 본문 SEO, 연관 키워드 자연 삽입
- Pinterest: 계절성, 라이프스타일 키워드, 롱테일 키워드
- Facebook: 도달율 극대화 해시태그, 그룹 공유 최적화

반드시 JSON 형식으로만 응답:
{
  "platform_seo": {
    "YouTube": { "title_keywords": [], "description_keywords": [], "tags": [] },
    "Instagram": { "hashtags_large": [], "hashtags_medium": [], "hashtags_small": [] },
    "TikTok": { "trending_tags": [], "challenge_tags": [] },
    "Naver": { "search_keywords": [], "related_keywords": [] },
    "Pinterest": { "keywords": [], "board_suggestion": "" },
    "Facebook": { "hashtags": [], "group_targets": [] }
  },
  "global_keywords": [],
  "trend_score": 0
}`

interface SeoResult {
  platform_seo: Record<string, Record<string, string[] | string>>
  global_keywords: string[]
  trend_score: number
}

export async function runSeoAgent(
  productName: string,
  category: string,
  market: string = 'KR',
): Promise<SeoResult> {
  if (USE_MOCK) {
    await mockDelay(600)
    return {
      platform_seo: {
        YouTube: { title_keywords: [productName, category, '추천'], description_keywords: ['쿠팡', '최저가'], tags: ['핫템', productName] },
        Instagram: { hashtags_large: ['#쇼핑', '#추천템'], hashtags_medium: [`#${productName}`], hashtags_small: [`#${category}추천`] },
        TikTok: { trending_tags: ['#틱톡핫템'], challenge_tags: [] },
        Naver: { search_keywords: [productName, `${category} 추천`], related_keywords: ['쿠팡'] },
        Pinterest: { keywords: [productName], board_suggestion: `${category} 추천템` },
        Facebook: { hashtags: ['#쇼핑추천'], group_targets: ['쿠팡 꿀팁', '절약 생활'] },
      },
      global_keywords: [productName, category],
      trend_score: 75,
    }
  }

  const langNote = market !== 'KR' ? `Target market: ${market}. Generate keywords in the appropriate language for that market.` : ''

  const userPrompt = `제품명: "${productName}"
카테고리: ${category}
마켓: ${market}
${langNote}

이 제품의 각 플랫폼별 SEO 키워드와 해시태그를 최적화하세요. 현재 트렌드를 반영한 실제 사용 키워드를 제시하세요.`

  return generateJSON<SeoResult>(SYSTEM_PROMPT, userPrompt)
}

export function buildOptimizedTags(seoResult: SeoResult, platform: string): string[] {
  const platformSeo = seoResult.platform_seo[platform]
  if (!platformSeo) return seoResult.global_keywords.slice(0, 10)

  const allTags: string[] = []
  for (const val of Object.values(platformSeo)) {
    if (Array.isArray(val)) allTags.push(...val)
  }
  return Array.from(new Set([...allTags, ...seoResult.global_keywords])).slice(0, 20)
}
