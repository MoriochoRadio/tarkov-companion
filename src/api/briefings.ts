// 일일 브리핑은 Cowork 파이프라인이 public/data/briefings/에 커밋한 정적 JSON.
// 스키마: docs/briefing-schema.md
export interface BriefingItem {
  title: string
  summary: string
  url?: string
  source?: string
}

export type SectionType = 'news' | 'tips' | 'community' | 'warning'

export interface BriefingSection {
  type: SectionType | string
  title: string
  items: BriefingItem[]
}

export interface Briefing {
  date: string
  generatedAt: string
  headline: string
  sections: BriefingSection[]
}

// GitHub Pages 하위 경로(/tarkov-companion/)에서도 동작하도록 BASE_URL 기준으로 fetch
const BASE = `${import.meta.env.BASE_URL}data/briefings/`

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path)
  if (!res.ok) {
    throw new Error(`브리핑 데이터 응답 오류 (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}

let indexCache: Promise<string[]> | null = null

export function fetchBriefingDates(): Promise<string[]> {
  indexCache ??= fetchJson<{ dates: string[] }>('index.json')
    .then((d) => d.dates)
    .catch((err: unknown) => {
      indexCache = null
      throw err
    })
  return indexCache
}

const briefingCache = new Map<string, Promise<Briefing>>()

export function fetchBriefing(date: string): Promise<Briefing> {
  let cached = briefingCache.get(date)
  if (!cached) {
    cached = fetchJson<Briefing>(`${date}.json`).catch((err: unknown) => {
      briefingCache.delete(date)
      throw err
    })
    briefingCache.set(date, cached)
  }
  return cached
}
