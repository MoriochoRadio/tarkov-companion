// FIR 통합 페이지(Phase 28) 전용 — 아이템 id별 tarkov.dev `types`(분류 매핑 재료)만
// 가볍게 받는다. 퀘스트/은신처 응답엔 types가 없어 별도 조회 (기존 타입은 그대로 둠).
// types는 언어 무관이라 lang 불필요. id 단위로 모듈 캐시 — 이미 받은 건 재요청 안 함.
const ENDPOINT = 'https://api.tarkov.dev/graphql'

const cache = new Map<string, string[]>()

const QUERY = `query($ids: [ID]) { items(ids: $ids) { id types } }`

// 주어진 id들의 types 맵을 돌려준다 (캐시에 없는 것만 한 번에 조회).
// 조회 실패 시 빈 배열로 폴백 — 분류는 '기타'로 떨어질 뿐 화면은 동작.
export async function fetchItemTypes(ids: string[]): Promise<Map<string, string[]>> {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id))
  if (missing.length) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { ids: missing } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as {
        data?: { items: { id: string; types: string[] | null }[] }
        errors?: { message: string }[]
      }
      if (json.errors?.length) throw new Error(json.errors[0].message)
      for (const it of json.data?.items ?? []) {
        cache.set(it.id, it.types ?? [])
      }
    } catch {
      // 무시 — 아래에서 미수신분을 빈 배열로 채워 재요청 폭주를 막는다
    }
    // 응답에 없던 id(또는 실패분)도 빈 배열로 고정해 매번 재조회하지 않게
    for (const id of missing) if (!cache.has(id)) cache.set(id, [])
  }
  const out = new Map<string, string[]>()
  for (const id of ids) out.set(id, cache.get(id) ?? [])
  return out
}
