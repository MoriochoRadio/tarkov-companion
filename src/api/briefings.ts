// 일일 브리핑은 Cowork 파이프라인이 public/data/briefings/에 커밋한 정적 JSON.
// 스키마: docs/briefing-schema.md
export interface BriefingItem {
  title: string
  summary?: string // 영상처럼 요약할 내용이 없는 항목은 생략
  url?: string
  source?: string
  isNew?: boolean // 어제 브리핑에 없던 새 이슈
}

export type SectionType = 'news' | 'tips' | 'community' | 'warning' | 'videos'

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
const DAILY_BASE = `${import.meta.env.BASE_URL}data/briefings/`
const WEEKLY_BASE = `${import.meta.env.BASE_URL}data/weekly/`

async function fetchJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(base + path)
  if (!res.ok) {
    throw new Error(`브리핑 데이터 응답 오류 (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}

let dailyIndexCache: Promise<string[]> | null = null

export function fetchBriefingDates(): Promise<string[]> {
  dailyIndexCache ??= fetchJson<{ dates: string[] }>(DAILY_BASE, 'index.json')
    .then((d) => d.dates)
    .catch((err: unknown) => {
      dailyIndexCache = null
      throw err
    })
  return dailyIndexCache
}

let weeklyIndexCache: Promise<string[]> | null = null

// 주간 리포트는 첫 발행 전까지 index가 없을 수 있음 → 404는 빈 목록으로 처리
export function fetchWeeklyDates(): Promise<string[]> {
  weeklyIndexCache ??= fetchJson<{ dates: string[] }>(WEEKLY_BASE, 'index.json')
    .then((d) => d.dates)
    .catch(() => [] as string[])
  return weeklyIndexCache
}

const docCache = new Map<string, Promise<Briefing>>()

function fetchDoc(base: string, date: string): Promise<Briefing> {
  const key = base + date
  let cached = docCache.get(key)
  if (!cached) {
    cached = fetchJson<Briefing>(base, `${date}.json`).catch((err: unknown) => {
      docCache.delete(key)
      throw err
    })
    docCache.set(key, cached)
  }
  return cached
}

export function fetchBriefing(date: string): Promise<Briefing> {
  return fetchDoc(DAILY_BASE, date)
}

// 주간 리포트도 같은 스키마를 쓰므로 렌더러를 공유할 수 있음
export function fetchWeeklyReport(date: string): Promise<Briefing> {
  return fetchDoc(WEEKLY_BASE, date)
}
