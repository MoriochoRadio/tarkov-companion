// tarkov.dev tasks 데이터셋 → 퀘스트 모델. 이름은 로케일 사전 ko/en 두 벌로 병기한다
// ("한국어명 (English)"). 참조가 전부 id라 items(아이템·열쇠)·traders·maps 데이터셋과
// 조인하며, 네 데이터셋 모두 다른 탭과 공유하는 캐시라 탭을 옮겨도 재요청은 없다
import {
  loadDataset,
  loadItems,
  loadTraders,
  trEn,
  trKo,
  type Dataset,
  type RawItemsData,
} from './jsonApi'

export interface QuestItemRef {
  id: string
  nameKo: string
  nameEn: string
  iconLink: string | null
  imageLink: string | null // 512px — 라이트박스용
}

// 목표가 잠긴 방/구역이면 필요한 열쇠 (Phase 28). 구조는 [[Key]] — 그룹 배열:
// 그룹 간 AND(모두 필요), 그룹 내 OR(아무거나). 실측: 단일 그룹·단일 키가 대부분,
// "219호 또는 220호"(그룹 내 복수=OR), "바깥문 + 안쪽문"(그룹 복수=AND) 사례 존재
export interface QuestKeyRef {
  id: string
  nameKo: string
  nameEn: string
  iconLink: string | null
}

export interface QuestObjective {
  id: string
  type: string
  description: string // 한국어 (일부 미번역은 영어 그대로 옴)
  optional: boolean
  maps: { id: string; name: string }[] // 목표가 묶인 맵 (없으면 장소 무관)
  items?: QuestItemRef[]
  count?: number
  foundInRaid?: boolean
  requiredKeys?: QuestKeyRef[][] // 잠긴 목표의 필요 열쇠 (그룹 배열)
  // 맵 퀘스트 플래너용 (Phase 25) — 지참물·처치 요약 재료
  markerItem?: QuestItemRef // mark: 설치할 마커 (MS2000 등)
  questItem?: { id: string; nameKo: string; nameEn: string } // 숨기기/회수 대상
  targetNames?: string[] // shoot: 처치 대상
  useItems?: QuestItemRef[] // useItem: 사용할 아이템 (신호탄 등)
  // 맵 마커용 (Phase 26) — zones 중심점 + 퀘스트 아이템 스폰 후보 (게임 월드 좌표)
  locations?: { mapId: string; x: number; z: number }[]
}

export interface QuestReward {
  items: (QuestItemRef & { count: number })[]
  standing: { trader: string; standing: number }[]
}

// 퀘스트 완료 보상 중 "트레이더 오퍼 해금" — 해금 탭의 역인덱스 재료
export interface OfferUnlock {
  item: QuestItemRef
  trader: { id: string; name: string }
  level: number // 트레이더 로열티 레벨 (LL)
}

export interface Quest {
  id: string
  nameKo: string
  nameEn: string
  displayName: string // "한국어명 (English)" — 병합 시 1회 계산
  searchKey: string // 소문자 ko+en — 검색 필터용 사전 계산
  trader: { id: string; name: string; imageLink: string | null }
  map: { id: string; name: string; normalizedName: string; wiki: string | null } | null
  minPlayerLevel: number
  experience: number
  kappaRequired: boolean
  wikiLink: string | null
  requires: string[] // 선행 퀘스트 id
  unlocks: string[] // 후행 퀘스트 id (requires의 역방향, 클라이언트 계산)
  objectives: QuestObjective[]
  rewards: QuestReward
  unlockOffers: OfferUnlock[]
}

// ---------- 원본(JSON API) 타입 — 참조는 전부 id ----------

interface RawPos {
  x: number
  z: number
}

interface RawObjective {
  id: string
  type: string
  description: string | null
  optional: boolean | null
  maps?: string[] | null
  items?: string[] | null
  count?: number | null
  foundInRaid?: boolean | null
  markerItem?: string | null
  questItem?: string | null
  targetNames?: string[] | null
  useAny?: string[] | null
  requiredKeys?: string[][] | null
  zones?: { map: string | null; position: RawPos | null }[] | null
  possibleLocations?: { map: string | null; positions: RawPos[] | null }[] | null
}

interface RawTask {
  id: string
  name: string
  trader: string
  map: string | null
  minPlayerLevel: number | null
  experience: number | null
  kappaRequired: boolean | null
  wikiLink: string | null
  taskRequirements: { task: string | null }[]
  objectives: RawObjective[]
  finishRewards: {
    items: { item: string; count: number }[]
    traderStanding: { trader: string; standing: number }[]
    offerUnlock: { level: number; trader: string; item: string }[]
  } | null
}

interface RawTasksData {
  tasks: Record<string, RawTask>
  questItems: Record<string, { id: string; name: string }>
}

interface RawMapsData {
  maps: Record<
    string,
    { id: string; name: string; normalizedName: string; wiki: string | null }
  >
}

interface Datasets {
  tasks: Dataset<RawTasksData>
  items: Dataset<RawItemsData>
  traders: Awaited<ReturnType<typeof loadTraders>>
  maps: Dataset<RawMapsData>
}

function buildQuests(d: Datasets): Quest[] {
  const { tasks, items, traders, maps } = d

  // 일반 아이템 참조 — 이름은 items 사전(ko/en), 아이콘·이미지는 아이템 본문
  const itemRef = (id: string): QuestItemRef => {
    const it = items.data.items[id]
    return {
      id,
      nameKo: trKo(items, it?.name),
      nameEn: trEn(items, it?.name),
      iconLink: it?.iconLink ?? null,
      imageLink: it?.image512pxLink ?? null,
    }
  }

  // 퀘스트 아이템(회수·설치 대상)은 일반 아이템 목록에 없고 tasks 데이터셋 안에 따로 있다
  const questItemRef = (id: string) => {
    const qi = tasks.data.questItems[id]
    return {
      id,
      nameKo: trKo(tasks, qi?.name),
      nameEn: trEn(tasks, qi?.name),
    }
  }

  const quests: Quest[] = Object.values(tasks.data.tasks).map((t) => {
    const nameKo = trKo(tasks, t.name)
    const nameEn = trEn(tasks, t.name)
    const trader = traders.data[t.trader]
    const map = t.map ? maps.data.maps[t.map] : null
    return {
      id: t.id,
      nameKo,
      nameEn,
      displayName: biName(nameKo, nameEn),
      searchKey: `${nameKo} ${nameEn}`.toLowerCase(),
      trader: {
        id: t.trader,
        name: trKo(traders, trader?.name),
        imageLink: trader?.imageLink ?? null,
      },
      map: map
        ? {
            id: map.id,
            name: trKo(maps, map.name),
            normalizedName: map.normalizedName,
            wiki: map.wiki,
          }
        : null,
      minPlayerLevel: t.minPlayerLevel ?? 1,
      experience: t.experience ?? 0,
      kappaRequired: t.kappaRequired ?? false,
      wikiLink: t.wikiLink,
      requires: t.taskRequirements
        .map((r) => r.task)
        .filter((id): id is string => Boolean(id)),
      unlocks: [],
      objectives: t.objectives.map((o) => ({
        id: o.id,
        type: o.type,
        description: trKo(tasks, o.description),
        optional: o.optional ?? false,
        maps: (o.maps ?? []).map((id) => ({
          id,
          name: trKo(maps, maps.data.maps[id]?.name),
        })),
        ...(o.items?.length ? { items: o.items.map(itemRef) } : {}),
        ...(o.count != null ? { count: o.count } : {}),
        ...(o.foundInRaid != null ? { foundInRaid: o.foundInRaid } : {}),
        ...(o.markerItem ? { markerItem: itemRef(o.markerItem) } : {}),
        ...(o.questItem ? { questItem: questItemRef(o.questItem) } : {}),
        ...(o.targetNames?.length
          ? { targetNames: o.targetNames.map((n) => trKo(tasks, n)) }
          : {}),
        ...(o.useAny?.length ? { useItems: o.useAny.map(itemRef) } : {}),
        ...(o.requiredKeys?.length
          ? {
              requiredKeys: o.requiredKeys.map((grp) =>
                grp.map((id) => {
                  const ref = itemRef(id)
                  return {
                    id: ref.id,
                    nameKo: ref.nameKo,
                    nameEn: ref.nameEn,
                    iconLink: ref.iconLink,
                  }
                }),
              ),
            }
          : {}),
        ...(() => {
          // zones 중심점 + 스폰 후보를 합쳐 마커 좌표 목록으로 (맵 마커용)
          const locs: { mapId: string; x: number; z: number }[] = []
          for (const zn of o.zones ?? []) {
            if (zn.map && zn.position) {
              locs.push({ mapId: zn.map, x: zn.position.x, z: zn.position.z })
            }
          }
          for (const pl of o.possibleLocations ?? []) {
            if (!pl.map) continue
            for (const p of pl.positions ?? []) {
              locs.push({ mapId: pl.map, x: p.x, z: p.z })
            }
          }
          return locs.length ? { locations: locs } : {}
        })(),
      })),
      rewards: {
        items: (t.finishRewards?.items ?? []).map((r) => ({
          ...itemRef(r.item),
          count: r.count,
        })),
        standing: (t.finishRewards?.traderStanding ?? []).map((s) => ({
          trader: trKo(traders, traders.data[s.trader]?.name),
          standing: s.standing,
        })),
      },
      // API가 같은 오퍼를 태스크 안에 두 번 주는 경우가 있어(Gunsmith Part 4 등 실측) 중복 제거 필수
      unlockOffers: dedupeOffers(t.finishRewards?.offerUnlock ?? []).map((o) => ({
        level: o.level,
        trader: { id: o.trader, name: trKo(traders, traders.data[o.trader]?.name) },
        item: itemRef(o.item),
      })),
    }
  })

  // 게임모드·이벤트로 같은 (영어명+상인) 퀘스트가 여러 id로 중복돼 옴
  // (실측: 래그맨 "New Beginning"이 4 id, "Make Amends" 3 id 등 — 좌측 목록 중복 +
  // 우측 FIR 집계 N배 과다의 원인). 대표 1개로 접고 후행 링크를 대표 기준으로 계산.
  return dedupeTasks(quests)
}

interface RawOffer {
  level: number
  trader: string
  item: string
}

function dedupeOffers(offers: RawOffer[]): RawOffer[] {
  const seen = new Set<string>()
  return offers.filter((o) => {
    const key = `${o.item}|${o.trader}|${o.level}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// (영어명+상인) 기준 중복 제거 — 대표는 목표가 가장 많은 것(동률이면 id 작은 것).
// requires는 대표 id로 재매핑하고 unlocks(후행)는 대표 집합에서 다시 계산.
function dedupeTasks(quests: Quest[]): Quest[] {
  const groups = new Map<string, Quest[]>()
  for (const q of quests) {
    const key = `${q.nameEn || q.id} ${q.trader.id}`
    const arr = groups.get(key)
    if (arr) arr.push(q)
    else groups.set(key, [q])
  }
  const repOf = new Map<string, string>() // 원래 id → 대표 id
  const reps: Quest[] = []
  for (const arr of groups.values()) {
    const rep = arr.reduce((a, b) =>
      b.objectives.length !== a.objectives.length
        ? b.objectives.length > a.objectives.length
          ? b
          : a
        : b.id < a.id
          ? b
          : a,
    )
    reps.push(rep)
    for (const q of arr) repOf.set(q.id, rep.id)
  }
  // requires를 대표 id로 재매핑 + 자기참조·중복 제거
  for (const q of reps) {
    q.requires = [
      ...new Set(
        q.requires.map((id) => repOf.get(id) ?? id).filter((id) => id !== q.id),
      ),
    ]
  }
  // 후행 = requires 역방향 (대표 집합 기준 재계산)
  const byId = new Map(reps.map((q) => [q.id, q]))
  for (const q of reps) q.unlocks = []
  for (const q of reps) {
    for (const reqId of q.requires) byId.get(reqId)?.unlocks.push(q.id)
  }
  return reps
}

let questsCache: Promise<Quest[]> | null = null

export function fetchQuests(): Promise<Quest[]> {
  questsCache ??= Promise.all([
    loadDataset<RawTasksData>('tasks'),
    loadItems(),
    loadTraders(),
    loadDataset<RawMapsData>('maps'),
  ])
    .then(([tasks, items, traders, maps]) =>
      buildQuests({ tasks, items, traders, maps }),
    )
    .catch((err: unknown) => {
      questsCache = null // 실패는 캐시하지 않고 재시도 가능하게
      throw err
    })
  return questsCache
}

// "한국어명 (English)" 병기 — 같거나 한국어명에 영어가 이미 포함되면 중복 표기 생략
export function biName(ko: string, en: string): string {
  if (!en || ko === en) return ko
  if (ko.toLowerCase().includes(en.toLowerCase())) return ko
  return `${ko} (${en})`
}
