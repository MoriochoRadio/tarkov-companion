// FIR 통합 페이지(Phase 28) 전용 — 아이템 id별 tarkov.dev `types`(분류 매핑 재료).
// 퀘스트/은신처 응답엔 types가 없어 아이템 쪽에서 가져온다.
// GraphQL 시절엔 id를 콕 집어 묻는 경량 쿼리였지만, JSON API는 아이템 데이터셋 한 벌을
// 통째로 캐시해 쓰므로 시세·모딩 등 다른 탭과 같은 캐시를 공유한다 (추가 요청 없음)
import { loadItems } from './jsonApi'

// 조회 실패 시 빈 배열로 폴백 — 분류는 '기타'로 떨어질 뿐 화면은 동작
export async function fetchItemTypes(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  let items: Record<string, { types: string[] }> = {}
  try {
    items = (await loadItems()).data.items
  } catch {
    // 무시 — 아래에서 전부 빈 배열로 채운다
  }
  for (const id of ids) out.set(id, items[id]?.types ?? [])
  return out
}
