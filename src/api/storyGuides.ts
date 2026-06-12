// 스토리 챕터 공략 — story-guides.yml(GitHub Models)이 위키 Guide 섹션을
// 충실 번역해 커밋한 정적 JSON. 아직 생성 전인 챕터는 404 → 'pending'
export interface StoryGuideImage {
  url: string // 위키 CDN 핫링크 (640px 썸네일)
  caption: string
}

export interface StoryGuideSection {
  title: string // 한국어
  titleEn: string
  body: string // 한국어 본문 — \n 단락, "- " 목록, "[소제목]" 줄
  images: StoryGuideImage[]
}

export interface StoryGuide {
  slug: string
  nameKo: string
  nameEn: string
  sections: StoryGuideSection[]
  sourceUrl: string
  license: string // "CC BY-SA"
  generatedAt: string
}

const BASE = `${import.meta.env.BASE_URL}data/story-guides/`

const cache = new Map<string, Promise<StoryGuide | 'pending'>>()

export function fetchStoryGuide(slug: string): Promise<StoryGuide | 'pending'> {
  let cached = cache.get(slug)
  if (!cached) {
    cached = fetch(`${BASE}${slug}.json`).then(async (res) => {
      if (res.status === 404) return 'pending' as const
      if (!res.ok) throw new Error(`공략 로드 실패 (HTTP ${res.status})`)
      const guide = (await res.json()) as StoryGuide
      // 초기 생성분에 표 장식용 아이템 아이콘이 섞여 있음 — 표시에서 제외
      for (const s of guide.sections) {
        s.images = s.images.filter((i) => !/icon\.(png|jpe?g|gif|webp)/i.test(i.url))
      }
      return guide
    })
    cached.catch(() => cache.delete(slug))
    cache.set(slug, cached)
  }
  return cached
}
