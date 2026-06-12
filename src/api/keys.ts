// 열쇠 가성비 분석용 — 열쇠 전종(약 300개)의 사용 횟수·퀘스트 연관.
// 시세·아이콘 포함 한 번만 받아 세션 캐시 (응답 수십 KB)
const ENDPOINT = 'https://api.tarkov.dev/graphql'

export interface KeyInfo {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  fleaPrice: number | null
  uses: number | null // null = 무제한(키카드 일부) 또는 정보 없음
  questNames: string[] // 이 열쇠가 필요한 퀘스트
  searchKey: string
}

const QUERY = `{
  items(lang: ko, types: keys) {
    id name shortName iconLink avg24hPrice
    properties { ... on ItemPropertiesKey { uses } }
    usedInTasks { name }
  }
}`

interface RawKey {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  avg24hPrice: number | null
  properties: { uses?: number | null } | null
  usedInTasks: { name: string }[]
}

let cache: Promise<KeyInfo[]> | null = null

export function fetchKeys(): Promise<KeyInfo[]> {
  cache ??= fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`tarkov.dev API 응답 오류 (HTTP ${res.status})`)
      const json = (await res.json()) as {
        data?: { items: RawKey[] }
        errors?: { message: string }[]
      }
      if (json.errors?.length) throw new Error(json.errors[0].message)
      if (!json.data) throw new Error('tarkov.dev API가 데이터를 반환하지 않음')
      return json.data.items.map((k) => ({
        id: k.id,
        name: k.name.trim(),
        shortName: k.shortName,
        iconLink: k.iconLink,
        fleaPrice: k.avg24hPrice,
        uses: k.properties?.uses ?? null,
        questNames: k.usedInTasks.map((t) => t.name),
        searchKey: `${k.name} ${k.shortName}`.toLowerCase(),
      }))
    })
    .catch((err: unknown) => {
      cache = null
      throw err
    })
  return cache
}
