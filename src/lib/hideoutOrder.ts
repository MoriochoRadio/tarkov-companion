import type { HideoutStation } from '../api/hideout'

// 은신처 건설 순서 — 선행 조건(같은 스테이션의 아래 레벨 + 다른 스테이션
// 레벨 요구)을 위상 정렬해 "이 순서대로 지으면 막히지 않는" 목록을 만든다.
// 같은 시점에 지을 수 있는 후보가 여럿이면 (트레이더 LL 게이트 → 스킬 요구
// → 레벨 → 이름) 순으로 빨리 풀리는 것부터 — LL 게이트는 선행 스테이션의
// 게이트를 물려받는다 (예: 선행이 LL3을 요구하면 자신도 사실상 LL3 이후).

export interface BuildStep {
  station: HideoutStation
  level: HideoutStation['levels'][number]
  /** 이 레벨까지 가는 데 필요한 최대 트레이더 LL (선행 포함, 1~4) */
  gateLL: number
}

const collator = new Intl.Collator('ko')

interface Node {
  key: string
  station: HideoutStation
  level: HideoutStation['levels'][number]
  deps: string[]
  gateLL: number
  skillMax: number
}

function better(a: Node, b: Node): boolean {
  return (
    a.gateLL - b.gateLL ||
    a.skillMax - b.skillMax ||
    a.level.level - b.level.level ||
    collator.compare(a.station.name, b.station.name)
  ) < 0
}

export function computeBuildOrder(stations: HideoutStation[]): BuildStep[] {
  const key = (stationId: string, level: number) => `${stationId}:${level}`
  const nodes = new Map<string, Node>()

  for (const s of stations) {
    for (const lv of s.levels) {
      const deps: string[] = []
      if (lv.level > 1) deps.push(key(s.id, lv.level - 1))
      for (const r of lv.stationRequirements) deps.push(key(r.stationId, r.level))
      nodes.set(key(s.id, lv.level), {
        key: key(s.id, lv.level),
        station: s,
        level: lv,
        deps,
        gateLL: Math.max(1, ...lv.traderRequirements.map((r) => r.level)),
        skillMax: Math.max(0, ...lv.skillRequirements.map((r) => r.level)),
      })
    }
  }
  // API에 없는 노드를 가리키는 요구는 무시 — 정렬이 영원히 막히지 않게
  for (const n of nodes.values()) {
    n.deps = n.deps.filter((d) => nodes.has(d))
  }

  const done = new Set<string>()
  const remaining = new Set(nodes.keys())
  const out: BuildStep[] = []

  while (remaining.size > 0) {
    let best: Node | null = null
    for (const k of remaining) {
      const n = nodes.get(k)!
      if (!n.deps.every((d) => done.has(d))) continue
      // 선행은 전부 done이라 게이트가 확정돼 있음 — 물려받아 확정
      n.gateLL = Math.max(n.gateLL, ...n.deps.map((d) => nodes.get(d)!.gateLL))
      if (!best || better(n, best)) best = n
    }
    if (!best) {
      // 순환 요구(데이터 이상) — 남은 것을 게이트·레벨순으로라도 붙여 끝낸다
      const rest = [...remaining].map((k) => nodes.get(k)!).sort((a, b) => (better(a, b) ? -1 : 1))
      for (const r of rest) out.push({ station: r.station, level: r.level, gateLL: r.gateLL })
      break
    }
    done.add(best.key)
    remaining.delete(best.key)
    out.push({ station: best.station, level: best.level, gateLL: best.gateLL })
  }
  return out
}
