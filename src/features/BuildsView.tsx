import { useMemo, useState } from 'react'
import {
  CATEGORY_LABELS,
  fetchBuildItems,
  fetchBuilds,
  slotOrder,
  type BuildCategory,
  type BuildDef,
  type BuildItemInfo,
} from '../api/builds'
import { fetchAmmo } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatRub } from '../lib/format'
import { TableSkeleton } from './Skeleton'

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
