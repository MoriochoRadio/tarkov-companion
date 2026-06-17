// 돈벌이 탭 데이터 — 은신처 크래프트(211개)·트레이더 바터(787개)의 레시피만
// 받고, 아이템 이름·아이콘·시세는 기존 전체 아이템 캐시(fetchAllItems)와
// 조인한다. 응답은 id+개수뿐이라 수십 KB.
const ENDPOINT = 'https://api.tarkov.dev/graphql'

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

const QUERY = `{
  crafts(lang: ko) {
    id station { id name } level duration
    requiredItems { item { id } count attributes { type } }
    rewardItems { item { id } count }
  }
  barters(lang: ko) {
    id trader { name } level taskUnlock { id }
    requiredItems { item { id } count }
    rewardItems { item { id } count }
  }
}`

interface RawIO {
  item: { id: string }
  count: number
  attributes?: { type: string }[] | null
}

interface RawData {
  crafts: {
    id: string
    station: { id: string; name: string }
    level: number
    duration: number
    requiredItems: RawIO[]
    rewardItems: RawIO[]
  }[]
  barters: {
    id: string
    trader: { name: string }
    level: number
    taskUnlock: { id: string } | null
    requiredItems: RawIO[]
    rewardItems: RawIO[]
  }[]
}

const mapIO = (list: RawIO[]): ProfitIO[] =>
  list.map((r) => ({
    id: r.item.id,
    count: r.count,
    isTool: (r.attributes ?? []).some((a) => a.type === 'tool'),
  }))

let cache: Promise<{ crafts: CraftInfo[]; barters: BarterInfo[] }> | null = null

export function fetchProfitData(): Promise<{
  crafts: CraftInfo[]
  barters: BarterInfo[]
}> {
  cache ??= fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`tarkov.dev API 응답 오류 (HTTP ${res.status})`)
      const json = (await res.json()) as {
        data?: RawData
        errors?: { message: string }[]
      }
      if (json.errors?.length) {
        throw new Error(`tarkov.dev API 오류: ${json.errors[0].message}`)
      }
      if (!json.data) throw new Error('tarkov.dev API가 데이터를 반환하지 않음')
      return {
        crafts: json.data.crafts.map((c) => ({
          id: c.id,
          stationId: c.station.id,
          stationName: c.station.name.trim(),
          level: c.level,
          duration: c.duration,
          inputs: mapIO(c.requiredItems),
          outputs: mapIO(c.rewardItems),
        })),
        barters: json.data.barters.map((b) => ({
          id: b.id,
          trader: b.trader.name.trim(),
          level: b.level,
          questLocked: b.taskUnlock != null,
          inputs: mapIO(b.requiredItems),
          outputs: mapIO(b.rewardItems),
        })),
      }
    })
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
