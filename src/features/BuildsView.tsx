import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BUILD_ZONES,
  CATEGORY_LABELS,
  fetchBuildItems,
  fetchBuilds,
  slotOrder,
  zoneFor,
  type BuildCategory,
  type BuildDef,
  type BuildItemInfo,
  type BuildZone,
} from '../api/builds'
import { fetchAmmo } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatRub } from '../lib/format'
import { ErrorState, TableSkeleton } from './Skeleton'

const collator = new Intl.Collator('ko')

// 부품 1개의 입수 가격 — 티어 내 트레이더 현금 최저가 / 티어 밖 최저 트레이더 / 플리
function pricing(item: BuildItemInfo, tier: number) {
  let traderInTier: BuildItemInfo['offers'][number] | null = null
  let traderAny: BuildItemInfo['offers'][number] | null = null
  for (const o of item.offers) {
    if (!traderAny || o.priceRUB < traderAny.priceRUB) traderAny = o
    if (o.traderLevel <= tier && (!traderInTier || o.priceRUB < traderInTier.priceRUB)) {
      traderInTier = o
    }
  }
  const flea = item.fleaPrice && item.fleaPrice > 0 ? item.fleaPrice : null
  // 이 티어에서 실제 살 수 있는 최저가 (트레이더 현금 vs 플리)
  const t = traderInTier?.priceRUB ?? Infinity
  const f = flea ?? Infinity
  const buyable = Math.min(t, f)
  return { traderInTier, traderAny, flea, buyable: buyable === Infinity ? null : buyable }
}

interface BuildView {
  def: BuildDef
  weapon: BuildItemInfo
  parts: BuildItemInfo[] // 슬롯 순서로 정렬됨
  traderCost: number | null // 트레이더(티어 내)만으로
  cheapCost: number | null // 플리 포함 최저가
  partial: boolean // 일부 부품 시세/구매처 없음 — 합계가 실제보다 낮음
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

// 부품 줄의 "어디서 사는 게 싼지" — 트레이더(티어 내) vs 플리, 싼 쪽 골드 강조
function PartBuy({ item, tier }: { item: BuildItemInfo; tier: number }) {
  const { traderInTier, traderAny, flea } = pricing(item, tier)
  const tPrice = traderInTier?.priceRUB ?? null
  const cheapFlea = flea != null && (tPrice == null || flea < tPrice)
  const cheapTrader = tPrice != null && (flea == null || tPrice <= flea)
  return (
    <span className="build-buy2 num">
      {traderInTier ? (
        <span className={`build-buy-opt${cheapTrader ? ' cheap' : ''}`}>
          {traderInTier.trader} LL{traderInTier.traderLevel}
          {traderInTier.questLocked && <span title="퀘스트 해금"> ⚿</span>}{' '}
          {formatRub(traderInTier.priceRUB)}
        </span>
      ) : traderAny ? (
        <span className="build-buy-opt dim" title={`이 티어 위 — ${traderAny.trader} LL${traderAny.traderLevel}`}>
          {traderAny.trader} LL{traderAny.traderLevel}
          {traderAny.questLocked && ' ⚿'} {formatRub(traderAny.priceRUB)}
        </span>
      ) : null}
      {flea != null && (
        <span className={`build-buy-opt${cheapFlea ? ' cheap' : ''}`}>
          플리 {formatRub(flea)}
        </span>
      )}
      {!traderInTier && !traderAny && flea == null && (
        <span className="dim">시세 없음 (레이드 파밍/물물교환)</span>
      )}
    </span>
  )
}

// 콜아웃용 최저가 1개 (트레이더 티어 내 vs 플리 중 싼 쪽)
function cheapest(item: BuildItemInfo, tier: number) {
  const { traderInTier, flea } = pricing(item, tier)
  const t = traderInTier?.priceRUB ?? Infinity
  const f = flea ?? Infinity
  if (t === Infinity && f === Infinity) return null
  if (t <= f) {
    return { price: traderInTier!.priceRUB, locked: traderInTier!.questLocked }
  }
  return { price: flea!, locked: false }
}

const REGIONS = ['top', 'left', 'right', 'bottom'] as const

// 인게임 모딩 창 풍 콜아웃 다이어그램 — 무기 그림 가운데, 부품을 구역별로 주변 배치 +
// 연결선. tarkov.dev에 장착 좌표가 없어 분류(slotNorm) 기반 구역 근사. 좁은 화면(<560px)
// 에선 CSS로 이미지 위 + 구역 헤더 스택 폴백(연결선 숨김). 펼친 카드에서만 마운트됨.
function BuildDiagram({
  weapon,
  parts,
  tier,
  onItem,
}: {
  weapon: BuildItemInfo
  parts: BuildItemInfo[]
  tier: number
  onItem?: (name: string) => void
}) {
  const banner = weapon.presetImageLink ?? weapon.imageLink

  // 부품을 구역별로 묶고 구역을 region/order로 정렬
  const grouped = useMemo(() => {
    const byZone = new Map<BuildZone, BuildItemInfo[]>()
    for (const p of parts) {
      const z = zoneFor(p.slotNorm)
      const a = byZone.get(z) ?? []
      a.push(p)
      byZone.set(z, a)
    }
    const out: Record<(typeof REGIONS)[number], { z: BuildZone; items: BuildItemInfo[] }[]> = {
      top: [],
      left: [],
      right: [],
      bottom: [],
    }
    for (const [z, items] of byZone) out[BUILD_ZONES[z].region].push({ z, items })
    for (const r of REGIONS) out[r].sort((a, b) => BUILD_ZONES[a.z].order - BUILD_ZONES[b.z].order)
    return out
  }, [parts])

  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLDivElement>(null)
  const zoneRefs = useRef(new Map<BuildZone, HTMLDivElement>())
  const pathRefs = useRef(new Map<BuildZone, SVGPathElement>())
  const [lines, setLines] = useState<{ z: BuildZone; d: string }[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [narrow, setNarrow] = useState(false) // 컨테이너 폭 기반 폴백 (뷰포트 아님)
  const [nonce, setNonce] = useState(0) // 무기 이미지 로드 후 연결선 재측정

  // 강조는 React 상태(리렌더) 대신 명령형 클래스 토글 — 호버마다 리렌더하면
  // 깜빡거림. 색만 바꾸고 크기는 안 건드린다 (연결선 두께 변화 없음)
  const setZoneOn = (z: BuildZone, on: boolean) => {
    pathRefs.current.get(z)?.classList.toggle('on', on)
  }

  // 연결선: 구역 박스 중심 → 무기 이미지의 구역 anchor. 좁은 화면이면 그리지 않음
  useLayoutEffect(() => {
    const measure = () => {
      const c = containerRef.current
      const img = imageRef.current
      if (!c || !img) return
      const cr = c.getBoundingClientRect()
      const isNarrow = cr.width < 560
      setNarrow(isNarrow)
      if (isNarrow) {
        setLines([])
        return
      }
      setSize({ w: cr.width, h: cr.height })
      const ir = img.getBoundingClientRect()
      const next: { z: BuildZone; d: string }[] = []
      for (const r of REGIONS) {
        for (const { z } of grouped[r]) {
          const el = zoneRefs.current.get(z)
          if (!el) continue
          const zr = el.getBoundingClientRect()
          const def = BUILD_ZONES[z]
          const ax = ir.left - cr.left + (def.anchor[0] / 100) * ir.width
          const ay = ir.top - cr.top + (def.anchor[1] / 100) * ir.height
          const zx = zr.left - cr.left + zr.width / 2
          const zy = zr.top - cr.top + zr.height / 2
          next.push({ z, d: `M ${zx} ${zy} L ${ax} ${ay}` })
        }
      }
      setLines(next)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [grouped, nonce])

  const renderZone = ({ z, items }: { z: BuildZone; items: BuildItemInfo[] }) => (
    <div
      key={z}
      ref={(el) => {
        if (el) zoneRefs.current.set(z, el)
        else zoneRefs.current.delete(z)
      }}
      className="bd-zone"
      onMouseEnter={() => setZoneOn(z, true)}
      onMouseLeave={() => setZoneOn(z, false)}
    >
      <span className="bd-zone-label">{BUILD_ZONES[z].label}</span>
      {items.map((p, i) => {
        const cheap = cheapest(p, tier)
        return (
          <button
            key={`${p.id}-${i}`}
            className="bd-callout"
            onClick={() => onItem?.(p.searchName)}
            onFocus={() => setZoneOn(z, true)}
            onBlur={() => setZoneOn(z, false)}
            title={`${p.displayName} — 아이템 검색`}
          >
            {p.iconLink && <img src={p.iconLink} alt="" loading="lazy" />}
            <span className="bd-co-text">
              <span className="bd-co-slot">
                {p.slotKo}
                {p.slotEn && p.slotEn !== p.slotKo && <span className="dim"> ({p.slotEn})</span>}
              </span>
              <span className="bd-co-name">{p.displayName}</span>
              <span className="bd-co-stats num">
                {p.ergonomics != null && p.ergonomics !== 0 && (
                  <span className={p.ergonomics > 0 ? 'stat-up' : 'down'}>
                    에르고 {p.ergonomics > 0 ? '+' : ''}
                    {p.ergonomics}
                  </span>
                )}
                {p.recoilModifier != null && p.recoilModifier !== 0 && (
                  <span className={p.recoilModifier < 0 ? 'stat-up' : 'down'}>
                    반동 {p.recoilModifier > 0 ? '+' : ''}
                    {Math.round(p.recoilModifier * 100)}%
                  </span>
                )}
              </span>
            </span>
            {cheap && (
              <span className="bd-co-price num">
                {formatRub(cheap.price)}
                {cheap.locked && ' ⚿'}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={`build-diagram${narrow ? ' narrow' : ''}`} ref={containerRef}>
      <svg className="build-diagram-lines" width={size.w} height={size.h} aria-hidden>
        {lines.map((l) => (
          <path
            key={l.z}
            ref={(el) => {
              if (el) pathRefs.current.set(l.z, el)
              else pathRefs.current.delete(l.z)
            }}
            d={l.d}
          />
        ))}
      </svg>
      <div className="bd-image" ref={imageRef}>
        {banner && (
          <img src={banner} alt="" loading="lazy" onLoad={() => setNonce((n) => n + 1)} />
        )}
      </div>
      {REGIONS.map((r) =>
        grouped[r].length > 0 ? (
          <div key={r} className={`bd-region bd-${r}`}>
            {grouped[r].map(renderZone)}
          </div>
        ) : null,
      )}
    </div>
  )
}

function BuildCard({
  view,
  expanded,
  onToggle,
  onItem,
}: {
  view: BuildView
  expanded: boolean
  onToggle: () => void
  onItem?: (name: string) => void
}) {
  const { def, weapon, parts } = view
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
          {def.tags && def.tags.length > 0 && (
            <span className="build-tags">
              {def.tags.map((t) => (
                <span key={t} className="build-tag">
                  {t}
                </span>
              ))}
            </span>
          )}
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
              <em>트레이더</em>
              {view.traderCost != null ? formatRub(view.traderCost) : '—'}
              {view.partial && <span className="dim">+α</span>}
            </span>
            <span>
              <em>플리 포함</em>
              {view.cheapCost != null ? formatRub(view.cheapCost) : '—'}
              {view.partial && <span className="dim">+α</span>}
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
          {/* 한눈 파악용 콜아웃 다이어그램 — 정확한 구매 정보는 아래 목록 */}
          <BuildDiagram weapon={weapon} parts={parts} tier={def.tier} onItem={onItem} />
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
          {/* 인게임 모딩 창처럼 슬롯 순서대로 — 무기부터 위→아래로 조립 */}
          <ul className="build-detail-list">
            {[weapon, ...parts].map((item, i) => {
              const slot =
                i === 0
                  ? '무기'
                  : item.slotKo ?? item.slotEn ?? '부품'
              const slotEn = i === 0 ? null : item.slotEn
              return (
                <li key={item.id} className="build-detail-row">
                  <button
                    className="build-part-link"
                    onClick={() => onItem?.(item.searchName)}
                    title={`${item.displayName} — 아이템 검색(시세·구매처)`}
                  >
                    {item.iconLink && <img src={item.iconLink} alt="" loading="lazy" />}
                    <span className="build-part-text">
                      <span className="build-slot-label">
                        {slot}
                        {slotEn && slotEn !== slot && <span className="dim"> ({slotEn})</span>}
                      </span>
                      <span className="build-detail-name">
                        {item.displayName}
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
                    </span>
                  </button>
                  <PartBuy item={item} tier={def.tier} />
                </li>
              )
            })}
          </ul>
          {weapon.caliber && <AmmoRecs caliber={weapon.caliber} />}
          <p className="hint build-fineprint">
            슬롯 순서·라벨은 부품 분류 기준(게임 실제 슬롯과 약간 다를 수 있음) · 배너는
            기본 프리셋 기준 · 에르고/반동은 부품 보정 단순 합산 근사치 · 부품을 누르면
            아이템 검색으로 이동
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

export function BuildsView({ onItem }: { onItem?: (name: string) => void }) {
  const state = useAsyncData(async () => {
    const builds = await fetchBuilds()
    const items = await fetchBuildItems(builds.flatMap((b) => [b.weapon, ...b.parts]))
    return { builds, items }
  })
  const [category, setCategory] = useState<'' | BuildCategory>('')
  const [tier, setTier] = useState('') // "내 트레이더 LL" — 이 레벨 이하 빌드만
  const [tag, setTag] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 모든 빌드의 태그 모음 (필터 옵션)
  const allTags = useMemo(() => {
    if (state.status !== 'ready') return []
    const s = new Set<string>()
    for (const b of state.data.builds) for (const t of b.tags ?? []) s.add(t)
    return [...s].sort(collator.compare)
  }, [state])

  const views = useMemo(() => {
    if (state.status !== 'ready') return []
    const { builds, items } = state.data
    const maxTier = tier ? Number(tier) : null
    const out: BuildView[] = []
    for (const def of builds) {
      if (category && def.category !== category) continue
      if (maxTier != null && def.tier > maxTier) continue
      if (tag && !(def.tags ?? []).includes(tag)) continue
      const weapon = items.get(def.weapon)
      if (!weapon) continue // API에서 사라진 무기 — 카드 자체를 숨김
      const parts = def.parts
        .map((id) => items.get(id))
        .filter((p): p is BuildItemInfo => Boolean(p))
        .sort(
          (a, b) =>
            slotOrder(a.slotNorm) - slotOrder(b.slotNorm) ||
            collator.compare(a.displayName, b.displayName),
        )

      let traderCost = 0
      let cheapCost = 0
      let partial = parts.length < def.parts.length
      for (const item of [weapon, ...parts]) {
        const pr = pricing(item, def.tier)
        if (pr.traderInTier) traderCost += pr.traderInTier.priceRUB
        else partial = true
        if (pr.buyable != null) cheapCost += pr.buyable
        else partial = true
      }
      const recoilSum = parts.reduce((s, p) => s + (p.recoilModifier ?? 0), 0)
      out.push({
        def,
        weapon,
        parts,
        traderCost: partial && traderCost === 0 ? null : traderCost,
        cheapCost: cheapCost || null,
        partial,
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
      (a, b) => a.def.tier - b.def.tier || (a.cheapCost ?? Infinity) - (b.cheapCost ?? Infinity),
    )
  }, [state, category, tier, tag])

  if (state.status === 'loading') {
    return <TableSkeleton rows={6} label="추천 빌드 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <ErrorState message={state.message} onRetry={state.reload} />
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
        {allTags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">전체 용도</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="hint">
        카드를 누르면 인게임 모딩 창처럼 슬롯 순서대로 부품·구매처 표시 · 부품별로
        트레이더(티어 내 현금) vs 플리 중 <span className="stat-up">싼 쪽을 강조</span> ·
        총비용은 “트레이더만” / “플리 포함” 두 가지 · ⚿ = 퀘스트 해금 · 부품을 누르면
        아이템 검색으로 이동 · 패치로 부품·시세가 바뀔 수 있습니다
      </p>
      {views.length === 0 && <p className="hint">조건에 맞는 빌드가 없습니다.</p>}
      <div className="build-grid">
        {views.map((v) => (
          <BuildCard
            key={v.def.id}
            view={v}
            expanded={expandedId === v.def.id}
            onToggle={() => setExpandedId(expandedId === v.def.id ? null : v.def.id)}
            onItem={onItem}
          />
        ))}
      </div>
    </div>
  )
}
