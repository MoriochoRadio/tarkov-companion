// 돈벌이 탭 데이터 — 은신처 크래프트(약 210개)·트레이더 바터(약 790개)의 레시피만
// 받고, 아이템 이름·아이콘·시세는 기존 전체 아이템 캐시(fetchAllItems)와 조인한다.
// crafts/barters 데이터셋은 id 참조뿐이라 가볍고(수십 KB) 로케일 사전도 없다 →
// 스테이션·트레이더 이름은 hideout/traders 데이터셋에서 가져온다
import { loadDataset, loadTraders, trKo, type Dataset } from './jsonApi'

export interface ProfitIO {
  id: string
  count: number
  isTool: boolean // 크래프트 도구 — 소모되지 않으므로 비용에서 제외
}

export interface CraftInfo {
  id: string
  stationId: string
  stationName: string
  level: number
  duration: number // 초
  inputs: ProfitIO[]
  outputs: ProfitIO[]
}

export interface BarterInfo {
  id: string
  trader: string
  level: number
  questLocked: boolean
  inputs: ProfitIO[]
  outputs: ProfitIO[]
}

interface RawIO {
  item: string
  count: number
  attributes?: { tool?: boolean } | null
}

interface RawCraft {
  id: string
  station: string
  level: number
  duration: number
  requiredItems: RawIO[]
  productItem: RawIO
}

interface RawBarter {
  id: string
  trader: string
  minTraderLevel: number | null
  taskUnlock: string | null
  requiredItems: RawIO[]
  offeredItem: RawIO
}

interface RawStations {
  [id: string]: { id: string; name: string }
}

const mapIO = (list: RawIO[]): ProfitIO[] =>
  list.map((r) => ({
    id: r.item,
    count: r.count,
    isTool: r.attributes?.tool === true,
  }))

let cache: Promise<{ crafts: CraftInfo[]; barters: BarterInfo[] }> | null = null

export function fetchProfitData(): Promise<{
  crafts: CraftInfo[]
  barters: BarterInfo[]
}> {
  cache ??= Promise.all([
    loadDataset<RawCraft[]>('crafts'),
    loadDataset<RawBarter[]>('barters'),
    loadDataset<RawStations>('hideout'),
    loadTraders(),
  ])
    .then(([crafts, barters, stations, traders]: [
      Dataset<RawCraft[]>,
      Dataset<RawBarter[]>,
      Dataset<RawStations>,
      Awaited<ReturnType<typeof loadTraders>>,
    ]) => ({
      crafts: crafts.data.map((c) => ({
        id: c.id,
        stationId: c.station,
        stationName: trKo(stations, stations.data[c.station]?.name),
        level: c.level,
        duration: c.duration,
        inputs: mapIO(c.requiredItems),
        outputs: mapIO([c.productItem]),
      })),
      barters: barters.data.map((b) => ({
        id: b.id,
        trader: trKo(traders, traders.data[b.trader]?.name),
        level: b.minTraderLevel ?? 1,
        questLocked: b.taskUnlock != null,
        inputs: mapIO(b.requiredItems),
        outputs: mapIO([b.offeredItem]),
      })),
    }))
    .catch((err: unknown) => {
      cache = null // 실패는 캐시하지 않고 재시도 가능하게
      throw err
    })
  return cache
}

// 제작/바터로 "나오는"(산출) 아이템 id 집합 — 필요템 리스트에서 "제작·바터 가능"
// 여부 판별용 (Phase 41). 같은 fetchProfitData 캐시를 공유한다
export function craftBarterOutputIds(data: {
  crafts: CraftInfo[]
  barters: BarterInfo[]
}): Set<string> {
  const ids = new Set<string>()
  for (const c of data.crafts) for (const o of c.outputs) ids.add(o.id)
  for (const b of data.barters) for (const o of b.outputs) ids.add(o.id)
  return ids
}
