// 1.0 스토리 챕터 — scripts/fetch-storyline.mjs가 EFT 위키(CC BY-SA)에서
// 생성해 커밋한 정적 JSON을 읽는다. tarkov.dev API에는 스토리 챕터가 없어
// (tasks 510개는 전부 트레이더 의뢰) 위키가 유일한 무료 소스.
export interface StoryObjective {
  text: string // 영어 원문 (위키)
  ko?: string // 한국어 번역 (scripts/storyline-objectives-ko.json 큐레이션)
  depth: number // 0=목표, 1~2=하위 단계
  optional?: boolean
  kind?: 'branch' | 'note' // branch=선택지/분기 제목, note=참고
}

export interface StoryChapter {
  slug: string
  order: number
  nameKo: string // 비공식 번역
  nameEn: string
  startKo: string // 시작 조건
  descKo: string
  final: boolean // 최종장 (엔딩 분기)
  wikiUrl: string
  objectives: StoryObjective[]
}

export interface StorylineData {
  generated: string
  source: string
  license: string
  chapters: StoryChapter[]
}

let cache: Promise<StorylineData> | null = null

export function fetchStoryline(): Promise<StorylineData> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/storyline.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`스토리라인 데이터 응답 오류 (HTTP ${res.status})`)
      return (await res.json()) as StorylineData
    })
    .catch((err: unknown) => {
      cache = null // 실패는 캐시하지 않고 재시도 가능하게
      throw err
    })
  return cache
}
