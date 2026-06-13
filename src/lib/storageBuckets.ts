// FIR 통합 페이지(Phase 28) — tarkov.dev item types를 한국어 보관 분류로 매핑.
// 친구 피드백: 스캐브 정크박스처럼 보관 위치별로 묶어 보이게.
//
// 매핑은 여기 한 곳만 고치면 됨. tarkov.dev `types`(ItemType enum) 기준이며
// 실측으로 검증함(2026-06-13):
//   - 권총 Makarov = [gun, wearable] → wearable은 가방·리그·총에 다 붙어 쓸모없음 → gear에서 제외
//   - Salewa = [meds, provisions], Propital 인젝터 = [injectors, meds, provisions]
//     → 의료를 음식보다 먼저 둬야 약/주사가 음료로 안 샘
//   - 가방=backpack, 리그/아머=rig/armor, 헬멧=helmet, 그래픽카드/전선=barter,
//     물·주스·위스키=provisions, 열쇠/키카드=keys, 탄약=ammo, 수류탄=grenade
// 한 아이템이 여러 type을 가질 수 있어 "위에서부터 먼저 걸리는 분류로 확정"하는
// 우선순위 규칙. 어디에도 안 걸리면 '기타'.

export type BucketId = 'gear' | 'weapon' | 'barter' | 'food' | 'meds' | 'keys' | 'other'

export interface Bucket {
  id: BucketId
  label: string
  hint: string
}

// 화면 표시 순서이자 매핑 우선순위 순서 (위가 먼저).
export const BUCKETS: Bucket[] = [
  { id: 'keys', label: '열쇠', hint: '열쇠·키카드' },
  { id: 'meds', label: '의료', hint: '구급·주사' },
  { id: 'food', label: '음식·음료', hint: '식량·음료' },
  { id: 'gear', label: '장비', hint: '가방·리그·아머·헬멧' },
  { id: 'weapon', label: '무기·부품', hint: '총·부품·탄약·수류탄' },
  { id: 'barter', label: '정크박스템', hint: '바터·전자제품' },
  { id: 'other', label: '기타', hint: '분류 미상' },
]

// 분류별 매칭 type 목록 (BUCKETS 순서대로 검사).
const TYPE_RULES: { bucket: BucketId; types: string[] }[] = [
  { bucket: 'keys', types: ['keys'] },
  { bucket: 'meds', types: ['meds', 'injectors'] },
  { bucket: 'food', types: ['provisions'] },
  // wearable은 의도적으로 제외 — 총에도 붙어 오분류를 일으킴
  { bucket: 'gear', types: ['backpack', 'rig', 'armor', 'armorPlate', 'helmet', 'headphones', 'glasses'] },
  { bucket: 'weapon', types: ['gun', 'mods', 'suppressor', 'pistolGrip', 'preset', 'ammo', 'ammoBox', 'grenade'] },
  { bucket: 'barter', types: ['barter'] },
]

export function bucketOf(types: readonly string[] | undefined): BucketId {
  if (types && types.length) {
    for (const rule of TYPE_RULES) {
      if (types.some((t) => rule.types.includes(t))) return rule.bucket
    }
  }
  return 'other'
}

// 우측 정크박스 그리드의 분류 전환 탭 — 친구 3분류(장비/정크박스템/음식) + 기타.
// 세부 7버킷은 그대로 두되(추후 정밀 분류용), 화면 탭은 이 4개로 접는다.
// 의료·열쇠·무기·부품은 모두 '기타'로 — 친구안에 없는 분류라 한곳에 묶음.
export type DisplayGroupId = 'gear' | 'barter' | 'food' | 'etc'

export const DISPLAY_GROUPS: { id: DisplayGroupId; label: string }[] = [
  { id: 'gear', label: '장비' },
  { id: 'barter', label: '정크박스템' },
  { id: 'food', label: '음식' },
  { id: 'etc', label: '기타' },
]

const TO_DISPLAY: Record<BucketId, DisplayGroupId> = {
  gear: 'gear',
  barter: 'barter',
  food: 'food',
  keys: 'etc',
  meds: 'etc',
  weapon: 'etc',
  other: 'etc',
}

export const displayGroupOf = (b: BucketId): DisplayGroupId => TO_DISPLAY[b]
