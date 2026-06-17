// 티커/커맨드 팔레트에서 탭으로 건너뛸 때 쓰는 1회용 전달자.
// props로 엮으면 App↔탭 시그니처가 바뀌므로 모듈 변수로 가볍게 처리
let pending: string | null = null

export function setPendingSearch(query: string) {
  pending = query
}

export function consumePendingSearch(): string | null {
  const p = pending
  pending = null
  return p
}

// 커맨드 팔레트 → 퀘스트 탭 상세 바로 열기
let pendingQuest: string | null = null

export function setPendingQuest(id: string) {
  pendingQuest = id
}

export function consumePendingQuest(): string | null {
  const p = pendingQuest
  pendingQuest = null
  return p
}

// 필요템 → 돈벌이 탭 "이 아이템 만들기/바꾸기" (Phase 41) — itemId 전달
let pendingProfit: string | null = null

export function setPendingProfit(id: string) {
  pendingProfit = id
}

export function consumePendingProfit(): string | null {
  const p = pendingProfit
  pendingProfit = null
  return p
}
