// 퀘스트 공략 — quest-guides.yml이 매일 30개씩 백필하는 정적 JSON
// 스키마: docs/quest-guide-schema.md
export interface QuestGuide {
  taskId: string
  nameKo: string
  nameEn: string
  steps: string[]
  tips?: string
  sourceUrl: string
  license: string // "CC BY-SA"
  generatedAt: string
}

// 'pending' = 아직 백필 안 됨, 'none' = 위키에 Guide 섹션이 없어 생성 불가
export type GuideStatus = QuestGuide | 'pending' | 'none'

const BASE = `${import.meta.env.BASE_URL}data/guides/`

interface GuideIndex {
  done: string[]
  skipped: string[]
}

let indexCache: Promise<GuideIndex> | null = null

function fetchGuideIndex(): Promise<GuideIndex> {
  indexCache ??= fetch(`${BASE}index.json`)
    .then(async (res) => {
      if (!res.ok) return { done: [], skipped: [] }
      return (await res.json()) as GuideIndex
    })
    .catch(() => ({ done: [], skipped: [] }))
  return indexCache
}

const guideCache = new Map<string, Promise<QuestGuide>>()

export async function fetchGuideStatus(taskId: string): Promise<GuideStatus> {
  const index = await fetchGuideIndex()
  if (index.skipped.includes(taskId)) return 'none'
  if (!index.done.includes(taskId)) return 'pending'
  let cached = guideCache.get(taskId)
  if (!cached) {
    cached = fetch(`${BASE}${taskId}.json`).then(async (res) => {
      if (!res.ok) throw new Error(`가이드 로드 실패 (HTTP ${res.status})`)
      return (await res.json()) as QuestGuide
    })
    cached.catch(() => guideCache.delete(taskId))
    guideCache.set(taskId, cached)
  }
  return cached
}
