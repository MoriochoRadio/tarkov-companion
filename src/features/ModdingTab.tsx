import { useMemo, useState } from 'react'
import {
  fetchItemSlots,
  fetchWeapons,
  type ModPart,
  type ModSlot,
  type WeaponSummary,
} from '../api/modding'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatRub } from '../lib/format'
import { BuildsView } from './BuildsView'
import { TableSkeleton } from './Skeleton'

type SortKey = 'ergo' | 'recoil' | 'price'

const collator = new Intl.Collator('ko')

// 부품의 "지금 조건에서 가장 싼 입수처" — 트레이더 레벨 필터를 통과한
// 오퍼 중 최저가. 레벨 미입력이면 모든 트레이더 오퍼 대상
function bestOffer(part: ModPart, maxLevel: number | null) {
  let best: ModPart['offers'][number] | null = null
  for (const o of part.offers) {
    if (maxLevel != null && o.traderLevel > maxLevel) continue
    if (!best || o.priceRUB < best.priceRUB) best = o
  }
  return best
}

function statClass(value: number, goodPositive: boolean): string {
  if (value === 0) return 'dim'
  return value > 0 === goodPositive ? 'up' : 'down'
}

// 부품 1행 — 스탯 칩 + 입수처 + (있으면) 하위 슬롯 드릴다운
function PartRow({
  part,
  maxLevel,
  onDrill,
}: {
  part: ModPart
  maxLevel: number | null
  onDrill: (part: ModPart) => void
}) {
  const offer = bestOffer(part, maxLevel)
  return (
    <li className="mod-part">
      {part.iconLink && <img src={part.iconLink} alt="" loading="lazy" />}
      <div className="mod-part-main">
        <span className="mod-part-name">{part.displayName}</span>
        <span className="mod-part-stats">
          {part.ergonomics != null && part.ergonomics !== 0 && (
            <span className={`num ${statClass(part.ergonomics, true)}`}>
              에르고 {part.ergonomics > 0 ? '+' : ''}
              {part.ergonomics}
            </span>
          )}
          {part.recoilModifier != null && part.recoilModifier !== 0 && (
            <span className={`num ${statClass(part.recoilModifier, false)}`}>
              반동 {part.recoilModifier > 0 ? '+' : ''}
              {Math.round(part.recoilModifier * 100)}%
            </span>
          )}
          {part.capacity != null && (
            <span className="num dim">장탄 {part.capacity}</span>
          )}
        </span>
        <span className="mod-part-buy">
          {offer ? (
            <>
              <span className="mod-trader">
                {offer.trader} LL{offer.traderLevel}
                {offer.questLocked && (
                  <span title="퀘스트 완료 후 구매 가능"> ⚿</span>
                )}
              </span>
              <span className="num">{formatRub(offer.priceRUB)}</span>
            </>
          ) : (
            <span className="dim">
              {maxLevel != null ? `LL${maxLevel} 구매 불가` : '트레이더 판매 없음'}
            </span>
          )}
          {part.fleaPrice != null && part.fleaPrice > 0 && (
            <span className="dim num">플리 {formatRub(part.fleaPrice)}</span>
          )}
        </span>
      </div>
      {part.hasSubSlots && (
        <button className="mod-drill" onClick={() => onDrill(part)}>
          하위 슬롯 ▸
        </button>
      )}
    </li>
  )
}

function SlotSection({
  slot,
  maxLevel,
  sortKey,
  onDrill,
}: {
  slot: ModSlot
  maxLevel: number | null
  sortKey: SortKey
  onDrill: (part: ModPart) => void
}) {
  const parts = useMemo(() => {
    let list = slot.parts
    if (maxLevel != null) {
      list = list.filter((p) => p.offers.some((o) => o.traderLevel <= maxLevel))
    }
    const price = (p: ModPart) =>
      bestOffer(p, maxLevel)?.priceRUB ?? p.fleaPrice ?? Infinity
    return [...list].sort((a, b) => {
      if (sortKey === 'ergo') {
        return (b.ergonomics ?? -Infinity) - (a.ergonomics ?? -Infinity)
      }
      if (sortKey === 'recoil') {
        return (a.recoilModifier ?? Infinity) - (b.recoilModifier ?? Infinity)
      }
      return price(a) - price(b)
    })
  }, [slot, maxLevel, sortKey])

  return (
    <details className="mod-slot">
      <summary>
        <span className="mod-slot-name">
          {slot.nameKo}
          {slot.nameEn && slot.nameEn !== slot.nameKo && (
            <span className="dim"> ({slot.nameEn})</span>
          )}
          {slot.required && <span className="badge-fir">필수</span>}
        </span>
        <span className="num dim">
          {parts.length}
          {maxLevel != null && parts.length !== slot.parts.length
            ? `/${slot.parts.length}`
            : ''}
          개
        </span>
      </summary>
      {parts.length === 0 ? (
        <p className="hint">조건에 맞는 부품이 없습니다</p>
      ) : (
        <ul className="mod-parts">
          {parts.map((p) => (
            <PartRow key={p.id} part={p} maxLevel={maxLevel} onDrill={onDrill} />
          ))}
        </ul>
      )}
    </details>
  )
}

// 선택한 아이템(무기 또는 하위 모드)의 슬롯 브라우저
function SlotBrowser({
  itemId,
  maxLevel,
  sortKey,
  onDrill,
}: {
  itemId: string
  maxLevel: number | null
  sortKey: SortKey
  onDrill: (part: ModPart) => void
}) {
  const state = useAsyncData(() => fetchItemSlots(itemId), [itemId])
  if (state.status === 'loading') {
    return <TableSkeleton rows={6} label="호환 부품 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }
  if (state.data.length === 0) {
    return <p className="hint">이 아이템에는 장착 슬롯이 없습니다.</p>
  }
  return (
    <div className="mod-slots">
      {state.data.map((s) => (
        <SlotSection
          key={s.id}
          slot={s}
          maxLevel={maxLevel}
          sortKey={sortKey}
          onDrill={onDrill}
        />
      ))}
    </div>
  )
}

// ---------- 무기 선택 화면 ----------

function WeaponPicker({ onPick }: { onPick: (w: WeaponSummary) => void }) {
  const state = useAsyncData(fetchWeapons)
  const [query, setQuery] = useState('')

  const weapons = useMemo(() => {
    if (state.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    return state.data
      .filter((w) => !q || w.searchKey.includes(q))
      .sort((a, b) => collator.compare(a.nameKo, b.nameKo))
  }, [state, query])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="무기 목록 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  return (
    <div>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="무기 이름 검색 (한국어/영어)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="hint">
        무기를 고르면 슬롯별 호환 부품을 보여줍니다 · {weapons.length}정
      </p>
      <ul className="weapon-grid">
        {weapons.map((w) => (
          <li key={w.id}>
            <button className="weapon-card" onClick={() => onPick(w)}>
              {w.iconLink && <img src={w.iconLink} alt="" loading="lazy" />}
              <span className="weapon-name">{w.displayName}</span>
              <span className="weapon-stats dim num">
                {w.caliber && <span>{w.caliber}</span>}
                {w.ergonomics != null && <span>에르고 {w.ergonomics}</span>}
                {w.recoilVertical != null && <span>반동 {w.recoilVertical}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- 부품 직접 탐색 (슬롯 드릴다운 브라우저) ----------

interface Crumb {
  id: string
  label: string
}

function PartsBrowser() {
  // 빈 스택 = 무기 선택 화면, 그 외 = 스택 마지막 아이템의 슬롯 브라우저
  const [stack, setStack] = useState<Crumb[]>([])
  const [levelText, setLevelText] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('ergo')

  const maxLevel =
    levelText && Number(levelText) >= 1 && Number(levelText) <= 4
      ? Number(levelText)
      : null
  const current = stack[stack.length - 1]

  return (
    <div>
      {!current ? (
        <WeaponPicker
          onPick={(w) => setStack([{ id: w.id, label: w.shortName || w.nameKo }])}
        />
      ) : (
        <div>
          <div className="toolbar">
            <nav className="mod-crumbs">
              <button className="quest-back" onClick={() => setStack([])}>
                ← 무기 선택
              </button>
              {stack.map((c, i) => (
                <button
                  key={`${c.id}-${i}`}
                  className={`mod-crumb${i === stack.length - 1 ? ' current' : ''}`}
                  onClick={() => setStack(stack.slice(0, i + 1))}
                  disabled={i === stack.length - 1}
                >
                  {c.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="toolbar">
            <select
              value={levelText}
              onChange={(e) => setLevelText(e.target.value)}
              title="모든 트레이더에 같은 레벨을 적용합니다"
            >
              <option value="">트레이더 레벨 전체</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  내 트레이더 LL{n} 이하
                </option>
              ))}
            </select>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="ergo">에르고노믹스순</option>
              <option value="recoil">반동 보정순</option>
              <option value="price">가격순</option>
            </select>
          </div>
          <p className="hint">
            슬롯을 누르면 부품 목록 · ⚿ = 퀘스트 해금 필요 · 트레이더 레벨을
            고르면 그 레벨에서 살 수 있는 부품만 (물물교환 제외) · “하위 슬롯”으로
            리시버·핸드가드 안쪽 부품 탐색
          </p>
          <SlotBrowser
            itemId={current.id}
            maxLevel={maxLevel}
            sortKey={sortKey}
            onDrill={(p) =>
              setStack([...stack, { id: p.id, label: p.shortName || p.nameKo }])
            }
          />
        </div>
      )}
    </div>
  )
}

// ---------- 탭 본체 ----------

export function ModdingTab({ onItem }: { onItem?: (name: string) => void }) {
  // 친구 피드백: 부품 백과보다 "레벨별 추천 빌드"가 먼저 — 브라우저는 토글로 강등
  const [mode, setMode] = useState<'builds' | 'browser'>('builds')

  return (
    <div>
      <div className="toolbar">
        <nav className="mode-seg" aria-label="모딩 보기 방식">
          <button
            className={mode === 'builds' ? 'active' : ''}
            onClick={() => setMode('builds')}
          >
            추천 빌드
          </button>
          <button
            className={mode === 'browser' ? 'active' : ''}
            onClick={() => setMode('browser')}
          >
            부품 직접 탐색
          </button>
        </nav>
        <p className="hint mod-builder-link">
          풀 빌드 시뮬레이션(호환 검증·스탯 합산)은{' '}
          <a
            className="source-link"
            href="https://tarkov.dev/gun-builder"
            target="_blank"
            rel="noreferrer"
          >
            tarkov.dev 빌더 ↗
          </a>
          에서
        </p>
      </div>
      {mode === 'builds' ? <BuildsView onItem={onItem} /> : <PartsBrowser />}
    </div>
  )
}
