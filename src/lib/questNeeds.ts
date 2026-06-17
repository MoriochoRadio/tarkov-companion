import { CURRENCY_IDS } from '../api/hideout'
import type { Quest, QuestItemRef, QuestObjective } from '../api/quests'

// 퀘스트 "단일 제출 아이템" 수요 추출 — 통합 체크리스트·퀘스트 아이템 뷰·정크박스·
// FIR 운영·퀘스트 상세가 똑같이 쓰던 필터를 한 곳으로 모음 (Phase 43).
// 기준: giveItem/plantItem(소모 제출) · items 정확히 1개 · 비화폐.
//   - "여러 아이템 중 하나" 선택형은 특정 아이템을 지목할 수 없어 제외
//   - findItem은 같은 퀘스트의 giveItem과 짝이라 세면 이중 계산 → 제외
//   - 화폐(루블 등) 제출 목표는 준비물이 아니라 제외

export interface QuestItemNeed {
  item: QuestItemRef
  count: number
  fir: boolean // foundInRaid === true (레이드 획득 필수)
}

// 한 목표가 단일 제출 아이템이면 그 아이템, 아니면 null
export function submitObjectiveItem(o: QuestObjective): QuestItemRef | null {
  if (o.type !== 'giveItem' && o.type !== 'plantItem') return null
  if (o.items?.length !== 1) return null
  if (CURRENCY_IDS.has(o.items[0].id)) return null
  return o.items[0]
}

// 퀘스트의 단일 제출 아이템 수요 전체 (count·fir 포함)
export function questSubmitNeeds(quest: Quest): QuestItemNeed[] {
  const out: QuestItemNeed[] = []
  for (const o of quest.objectives) {
    const item = submitObjectiveItem(o)
    if (!item) continue
    out.push({ item, count: o.count ?? 1, fir: o.foundInRaid === true })
  }
  return out
}
