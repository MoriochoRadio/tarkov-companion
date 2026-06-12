import { useMemo, useState } from 'react'
import {
  CATEGORY_LABELS,
  fetchBuildItems,
  fetchBuilds,
  type BuildCategory,
  type BuildDef,
  type BuildItemInfo,
} from '../api/builds'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatRub } from '../lib/format'
import { TableSkeleton } from './Skeleton'

// 빌드 티어 기준 입수처: 티어 이하 트레이더 현금 오퍼 최저가 → 없으면 플리 시세
function buyInfo(item: BuildItemInfo, tier: number) {
  let best: BuildItemInfo['offers'][number] | null = null
  for (const o of item.offers) {
    if (o.traderLevel <= tier && (!best || o.priceRUB < best.priceRUB)) best = o
  }
  if (best) {
    return {
      label: `${best.trader} LL${best.traderLevel}${best.questLocked ? ' ⚿' : ''}`,
      price: best.priceRUB,
    }
  }
  if (item.fleaPrice && item.fleaPrice > 0) {
    return { label: '플리마켓', price: item.fleaPrice }
  }
  return null
}

interface BuildView {
  def: BuildDef
  weapon: BuildItemInfo
  parts: BuildItemInfo[]
  cost: number | null
  costPartial: boolean // 일부 부품 시세 없음 — 합계가 실제보다 낮음
  ergo: number | null
  recoil: number | null
}

function BuildCard({
  view,
  expanded,
  onToggle,
}: {
  view: BuildView
  expanded: boolean
  onToggle: () => void
}) {
  const { def, weapon, parts } = view
  const rows = [weapon, ...parts]
  return (
    <article className={`build-card${expanded ? ' open' : ''}`}>
      <button className="build-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="build-banner">
          {weapon.imageLink && <img src={weapon.imageLink} alt="" loading="lazy" />}
          <span className="build-badges">
            <span className="build-tier">LL{def.tier}</span>
            <span className="build-cat">{CATEGORY_LABELS[def.category]}</span>
          </span>
        </span>
        <span className="build-body">
          <span className="build-name">{def.name}</span>
          <span className="build-weapon dim">{weapon.displayName}</span>
          <span className="build-strip">
            {parts.map(
              (p) =>
                p.iconLink && (
                  <img key={p.id} src={p.iconLink} alt="" loading="lazy" title={p.displayName} />
                ),
            )}
          </span>
          <span className="build-stats num">
            <span>
              <em>총비용</em>
              {view.cost != null ? formatRub(view.cost) : '—'}
              {view.costPartial && <span className="dim">+α</span>}
            </span>
            <span>
              <em>에르고</em>
              {view.ergo ?? '—'}
            </span>
            <span>
              <em>수직반동</em>
              {view.recoil ?? '—'}
            </span>
          </span>
          <span className="build-desc">{def.desc}</span>
        </span>
      </button>
      {expanded && (
        <ul className="build-detail">
          {rows.map((item, i) => {
            const buy = buyInfo(item, def.tier)
            return (
              <li key={item.id}>
                {item.iconLink && <img src={item.iconLink} alt="" loading="lazy" />}
                <span className="build-detail-name">
                  {item.displayName}
                  {i === 0 && <span className="prep-chip">무기</span>}
                </span>
                <span className="build-detail-buy">
                  {buy ? (
                    <>
                      <span className="dim">{buy.label}</span>
                      <span className="num">{formatRub(buy.price)}</span>
                    </>
                  ) : (
                    <span className="dim">시세 없음 (레이드 파밍/물물교환)</span>
                  )}
                </span>
              </li>
            )
          })}
          {def.source && (
            <li className="build-source">
              <a className="source-link" href={def.source} target="_blank" rel="noreferrer">
                참고 자료 ↗
              </a>
            </li>
          )}
        </ul>
      )}
    </article>
  )
}

export function BuildsView() {
  const state = useAsyncData(async () => {
    const builds = await fetchBuilds()
    const items = await fetchBuildItems(builds.flatMap((b) => [b.weapon, ...b.parts]))
    return { builds, items }
  })
  const [category, setCategory] = useState<'' | BuildCategory>('')
  const [tier, setTier] = useState('') // "내 트레이더 LL" — 이 레벨 이하 빌드만
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const views = useMemo(() => {
    if (state.status !== 'ready') return []
    const { builds, items } = state.data
    const maxTier = tier ? Number(tier) : null
    const out: BuildView[] = []
    for (const def of builds) {
      if (category && def.category !== category) continue
      if (maxTier != null && def.tier > maxTier) continue
      const weapon = items.get(def.weapon)
      if (!weapon) continue // API에서 사라진 무기 — 카드 자체를 숨김
      const parts = def.parts
        .map((id) => items.get(id))
        .filter((p): p is BuildItemInfo => Boolean(p))

      let cost = 0
      let costPartial = parts.length < def.parts.length
      for (const item of [weapon, ...parts]) {
        const buy = buyInfo(item, def.tier)
        if (buy) cost += buy.price
        else costPartial = true
      }
      const ergo =
        weapon.ergonomics != null
          ? Math.round(weapon.ergonomics + parts.reduce((s, p) => s + (p.ergonomics ?? 0), 0))
          : null
      const recoil =
        weapon.recoilVertical != null
          ? Math.round(
              weapon.recoilVertical *
                (1 + parts.reduce((s, p) => s + (p.recoilModifier ?? 0), 0)),
            )
          : null
      out.push({ def, weapon, parts, cost, costPartial, ergo, recoil })
    }
    return out.sort(
      (a, b) => a.def.tier - b.def.tier || (a.cost ?? Infinity) - (b.cost ?? Infinity),
    )
  }, [state, category, tier])

  if (state.status === 'loading') {
    return <TableSkeleton rows={6} label="추천 빌드 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  return (
    <div>
      <div className="toolbar">
        <select value={category} onChange={(e) => setCategory(e.target.value as '' | BuildCategory)}>
          <option value="">전체 카테고리</option>
          {(Object.keys(CATEGORY_LABELS) as BuildCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="">트레이더 레벨 전체</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              내 트레이더 LL{n} 이하
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        카드를 누르면 부품별 가격·구매처 · 총비용 = 실시간 시세 합산(티어 내
        트레이더 현금가 우선, 없으면 플리) · 에르고/반동은 부품 보정 단순 합산
        근사치 · ⚿ = 퀘스트 해금 · 빌드는 참고용이며 패치로 부품·시세가 바뀔 수
        있습니다
      </p>
      {views.length === 0 && <p className="hint">조건에 맞는 빌드가 없습니다.</p>}
      <div className="build-grid">
        {views.map((v) => (
          <BuildCard
            key={v.def.id}
            view={v}
            expanded={expandedId === v.def.id}
            onToggle={() => setExpandedId(expandedId === v.def.id ? null : v.def.id)}
          />
        ))}
      </div>
    </div>
  )
}
