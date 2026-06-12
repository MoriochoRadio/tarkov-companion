import { useMemo, useState } from 'react'
import {
  CATEGORY_LABELS,
  fetchBuildItems,
  fetchBuilds,
  type BuildCategory,
  type BuildDef,
  type BuildItemInfo,
} from '../api/builds'
import { fetchAmmo } from '../api/tarkov'
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
  ergoBase: number | null
  ergo: number | null
  recoilBase: number | null
  recoil: number | null
  recoilH: number | null
  weight: number
}

// 전→후 한 쌍 — 좋아진 쪽을 골드로
function Delta({
  base,
  final,
  lowerIsBetter = false,
}: {
  base: number | null
  final: number | null
  lowerIsBetter?: boolean
}) {
  if (final == null) return <>—</>
  if (base == null || base === final) return <>{final}</>
  const improved = lowerIsBetter ? final < base : final > base
  return (
    <>
      <span className="dim">{base} →</span>{' '}
      <span className={improved ? 'stat-up' : 'down'}>{final}</span>
    </>
  )
}

// 인게임 풍 스탯 바 — 에르고는 높을수록, 반동은 낮을수록 길게(좋게) 표시
function StatBar({ pct }: { pct: number }) {
  return (
    <span className="stat-bar" aria-hidden>
      <span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </span>
  )
}

// 이 빌드 구경의 추천 탄약 톱 3 (관통력순) — 탄약 캐시는 탄약 탭과 공유
function AmmoRecs({ caliber }: { caliber: string }) {
  const state = useAsyncData(fetchAmmo)
  if (state.status !== 'ready') return <p className="hint">추천 탄약 불러오는 중…</p>
  const top = state.data
    .filter((a) => a.caliber?.replace(/^Caliber/, '') === caliber)
    .sort((a, b) => b.penetrationPower - a.penetrationPower)
    .slice(0, 3)
  if (top.length === 0) return null
  return (
    <div className="build-ammo">
      <h4>추천 탄약 (관통력순)</h4>
      <ul>
        {top.map((a) => (
          <li key={a.item.id}>
            {a.item.iconLink && <img src={a.item.iconLink} alt="" loading="lazy" />}
            <span className="build-ammo-name">{a.item.shortName}</span>
            <span className="num">
              관통 <strong>{a.penetrationPower}</strong>
            </span>
            <span className="num dim">데미지 {a.damage}</span>
            <span className="num dim">{formatRub(a.item.avg24hPrice)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
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
  const banner = weapon.presetImageLink ?? weapon.imageLink
  return (
    <article className={`build-card${expanded ? ' open' : ''}`}>
      <button className="build-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="build-banner">
          {banner && <img src={banner} alt="" loading="lazy" />}
          <span className="build-badges">
            <span className="build-tier">LL{def.tier}</span>
            <span className="build-cat">{CATEGORY_LABELS[def.category]}</span>
          </span>
          {weapon.caliber && <span className="build-caliber num">{weapon.caliber}</span>}
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
              <Delta base={view.ergoBase} final={view.ergo} />
              {view.ergo != null && <StatBar pct={view.ergo} />}
            </span>
            <span>
              <em>수직반동</em>
              <Delta base={view.recoilBase} final={view.recoil} lowerIsBetter />
              {view.recoil != null && <StatBar pct={100 - view.recoil / 5} />}
            </span>
          </span>
          <span className="build-desc">{def.desc}</span>
        </span>
      </button>
      {expanded && (
        <div className="build-detail">
          <dl className="build-spec num">
            <div>
              <dt>수평반동</dt>
              <dd>{view.recoilH ?? '—'}</dd>
            </div>
            <div>
              <dt>연사력</dt>
              <dd>{weapon.fireRate != null ? `${weapon.fireRate}rpm` : '—'}</dd>
            </div>
            <div>
              <dt>총 무게</dt>
              <dd>{view.weight.toFixed(2)}kg</dd>
            </div>
          </dl>
          <ul className="build-detail-list">
            {rows.map((item, i) => {
              const buy = buyInfo(item, def.tier)
              return (
                <li key={item.id}>
                  {item.iconLink && <img src={item.iconLink} alt="" loading="lazy" />}
                  <span className="build-detail-name">
                    {item.displayName}
                    {i === 0 && <span className="prep-chip">무기</span>}
                    <span className="build-detail-stats num">
                      {item.ergonomics != null && item.ergonomics !== 0 && i > 0 && (
                        <span className={item.ergonomics > 0 ? 'stat-up' : 'down'}>
                          에르고 {item.ergonomics > 0 ? '+' : ''}
                          {item.ergonomics}
                        </span>
                      )}
                      {item.recoilModifier != null && item.recoilModifier !== 0 && (
                        <span className={item.recoilModifier < 0 ? 'stat-up' : 'down'}>
                          반동 {item.recoilModifier > 0 ? '+' : ''}
                          {Math.round(item.recoilModifier * 100)}%
                        </span>
                      )}
                    </span>
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
          </ul>
          {weapon.caliber && <AmmoRecs caliber={weapon.caliber} />}
          <p className="hint build-fineprint">
            배너 이미지는 기본 프리셋 기준(부품 구성과 다를 수 있음) · 에르고/반동은
            부품 보정 단순 합산 근사치
            {def.source && (
              <>
                {' · '}
                <a className="source-link" href={def.source} target="_blank" rel="noreferrer">
                  참고 자료 ↗
                </a>
              </>
            )}
          </p>
        </div>
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
      const recoilSum = parts.reduce((s, p) => s + (p.recoilModifier ?? 0), 0)
      out.push({
        def,
        weapon,
        parts,
        cost,
        costPartial,
        ergoBase: weapon.ergonomics,
        ergo:
          weapon.ergonomics != null
            ? Math.round(weapon.ergonomics + parts.reduce((s, p) => s + (p.ergonomics ?? 0), 0))
            : null,
        recoilBase: weapon.recoilVertical,
        recoil:
          weapon.recoilVertical != null
            ? Math.round(weapon.recoilVertical * (1 + recoilSum))
            : null,
        recoilH:
          weapon.recoilHorizontal != null
            ? Math.round(weapon.recoilHorizontal * (1 + recoilSum))
            : null,
        weight: weapon.weight + parts.reduce((s, p) => s + p.weight, 0),
      })
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
        카드를 누르면 부품별 가격·스탯 보정·추천 탄약 · 총비용 = 실시간 시세
        합산(티어 내 트레이더 현금가 우선, 없으면 플리) · ⚿ = 퀘스트 해금 ·
        빌드는 참고용이며 패치로 부품·시세가 바뀔 수 있습니다
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
