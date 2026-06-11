// 티커에서 아이템을 클릭하면 검색 탭이 그 이름으로 열리게 하는 1회용 전달자.
// props로 엮으면 App↔SearchTab 시그니처가 바뀌므로 모듈 변수로 가볍게 처리
let pending: string | null = null

export function setPendingSearch(query: string) {
  pending = query
}

export function consumePendingSearch(): string | null {
  const p = pending
  pending = null
  return p
}
