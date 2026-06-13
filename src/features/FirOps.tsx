import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CURRENCY_IDS,
  fetchHideoutStations,
  type HideoutStation,
} from '../api/hideout'
import { fetchItemTypes } from '../api/itemTypes'
import { biName, fetchQuests, type Quest } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import {
  DONE_QUESTS_KEY,
  HIDEOUT_BUILT_KEY,
  useIdSet,
} from '../lib/favorites'
import { formatNumber } from '../lib/format'
import { usePrepCounts } from '../lib/prepCounts'
import {
  bucketOf,
  DISPLAY_GROUPS,
  type DisplayGroupId,
  displayGroupOf,
} from '../lib/storageBuckets'
import { builtKey, cascadeBuilt } from './HideoutView'
import { TableSkeleton } from './Skeleton'

// FIR 통합 운영 페이지 (Phase 27 최종) — 친구 스케치.
// 좌: 소스 패널. 퀘스트는 상인 가로 선택 → 그 상인 퀘스트가 레벨 오름차순
// 아코디언으로 펼쳐지고, 각 퀘스트 행에 필요 FIR 아이콘(×수량) + "클리어함".
// 하이드아웃은 스테이션 행 + "건축 완료". 완료 행은 어둡게 + 빗금.
// 우: 남은 FIR을 분류별 정크박스 그리드 + "− 보유 +" 스테퍼. 좌측에서 완료를
// 누르면 그 수요가 우측에서 실시간으로 빠진다. 수량은 클릭 누적이 아니라
// 스테퍼로 직접 증감 (tc:prep-counts 공유 — 준비물/체크리스트와 같은 저장소).

const FIRST_PAINT = 36 // 아이콘+스테퍼 타일 그리드 2단계 렌더 (Phase 17 교훈)
const collator = new Intl.Collator('ko')

interface ItemRef {
  id: string
  nameKo: string
  nameEn: string
  iconLink: string | null
}

// 퀘스트의 FIR 제출/설치 단일 아이템 목표만 (화폐 제외) — 준비물 집계와 같은 규칙
function questFirNeeds(quest: Quest): { item: ItemRef; count: number }[] {
  return quest.objectives
    .filter(
      (o) =>
        (o.type === 'giveItem' || o.type === 'plantItem') &&
        o.foundInRaid === true &&
        o.items?.length === 1 &&
        !CURRENCY_IDS.has(o.items[0].id),
    )
    .map((o) => ({ item: o.items![0], count: o.count ?? 1 }))
}

interface DemandItem {
  item: ItemRef
  need: number
  group: DisplayGroupId
}

// ---------- 우측: 정크박스 그리드 타일 (스테퍼) ----------

function FirTile({
  d,
  got,
  onAdd,
}: {
  d: DemandItem
  got: number
  onAdd: (delta: number) => void
}) {
  const remaining = Math.max(0, d.need - got)
  const done = remaining === 0
  const name = biName(d.item.nameKo, d.item.nameEn)
  return (
    <div className={`fir-tile${done ? ' done' : ''}`}>
      <div className="fir-tile-icon" title={name}>
        {d.item.iconLink && <img src={d.item.iconLink} alt="" loading="lazy" />}
        <span className="junk-count num">{done ? '✓' : `×${remaining}`}</span>
      </div>
      <span className="fir-tile-name">{name}</span>
      <div className="fir-stepper">
        <button
          className="fir-step"
          onClick={() => onAdd(-1)}
          disabled={got === 0}
          aria-label={`${name} 보유 −1`}
        >
          −
        </button>
        <span className="num fir-have">
          {got}
          <span className="dim">/{d.need}</span>
        </span>
        <button
          className="fir-step"
          onClick={() => onAdd(1)}
          disabled={got >= d.need}
          aria-label={`${name} 보유 +1`}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ---------- 좌측: 퀘스트 소스 (상인 선택 + 아코디언) ----------

interface TraderGroup {
  trader: Quest['trader']
  quests: { q: Quest; needs: { item: ItemRef; count: number }[] }[]
}

function QuestSource({
  quests,
  done,
  onToggle,
}: {
  quests: Quest[]
  done: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  // 상인별 FIR 제출 퀘스트 — 상인은 이름순, 퀘스트는 레벨 오름차순
  const traders = useMemo(() => {
    const byTrader = new Map<string, TraderGroup>()
    for (const q of quests) {
      const needs = questFirNeeds(q)
      if (needs.length === 0) continue
      let g = byTrader.get(q.trader.id)
      if (!g) {
        g = { trader: q.trader, quests: [] }
        byTrader.set(q.trader.id, g)
      }
      g.quests.push({ q, needs })
    }
    const out = [...byTrader.values()]
    for (const g of out) {
      g.quests.sort(
        (a, b) =>
          a.q.minPlayerLevel - b.q.minPlayerLevel ||
          collator.compare(a.q.nameKo, b.q.nameKo),
      )
    }
    return out.sort((a, b) => collator.compare(a.trader.name, b.trader.name))
  }, [quests])

  const [sel, setSel] = useState<string | null>(null)
  const selected = traders.find((t) => t.trader.id === sel) ?? traders[0] ?? null

  return (
    <div>
      <div className="tk-traders" role="tablist" aria-label="상인 선택">
        {traders.map((g) => {
          const remain = g.quests.filter((x) => !done.has(x.q.id)).length
          return (
            <button
              key={g.trader.id}
              role="tab"
              aria-selected={selected?.trader.id === g.trader.id}
              className={`tk-trader${
                selected?.trader.id === g.trader.id ? ' active' : ''
              }`}
              onClick={() => setSel(g.trader.id)}
            >
              {g.trader.imageLink && (
                <img src={g.trader.imageLink} alt="" width={40} height={40} loading="lazy" />
              )}
              <span>{g.trader.name}</span>
              <span className="dim num">{remain}</span>
            </button>
          )
        })}
      </div>

      {selected && (
        <ul className="fir-q-list">
          {selected.quests.map(({ q, needs }) => {
            const isDone = done.has(q.id)
            return (
              <li key={q.id} className={`fir-q-row${isDone ? ' done' : ''}`}>
                <div className="fir-q-head">
                  <span className="dim num fir-src-lv">Lv{q.minPlayerLevel}</span>
                  <span className="fir-q-name">
                    {q.displayName}
                    {q.kappaRequired && <span className="badge-kappa">κ</span>}
                  </span>
                  <button
                    className={`btn-ext fir-done-btn${isDone ? ' active' : ''}`}
                    onClick={() => onToggle(q.id)}
                  >
                    {isDone ? '✓ 클리어함 · 취소' : '클리어함'}
                  </button>
                </div>
                <div className="fir-q-items">
                  {needs.map((n, i) => (
                    <span
                      key={`${n.item.id}-${i}`}
                      className="fir-q-item"
                      title={`${biName(n.item.nameKo, n.item.nameEn)} ×${n.count}`}
                    >
                      {n.item.iconLink && (
                        <img src={n.item.iconLink} alt="" loading="lazy" />
                      )}
                      <span className="num">×{n.count}</span>
                    </span>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------- 좌측: 하이드아웃 소스 ----------

function HideoutSource({
  stations,
  built,
  setBuilt,
}: {
  stations: HideoutStation[]
  built: ReadonlySet<string>
  setBuilt: (id: string, on: boolean) => void
}) {
  const rows = useMemo(
    () => [...stations].sort((a, b) => collator.compare(a.name, b.name)),
    [stations],
  )
  return (
    <ul className="fir-src-list">
      {rows.map((s) => {
        const total = s.levels.length
        const builtCount = s.levels.filter((lv) =>
          built.has(builtKey(s.id, lv.level)),
        ).length
        const all = builtCount === total
        const firLeft = s.levels.some(
          (lv) =>
            !built.has(builtKey(s.id, lv.level)) &&
            lv.items.some((r) => r.fir && !r.isCurrency),
        )
        const toggleAll = () => {
          if (all) cascadeBuilt(setBuilt, s, s.levels[0].level, false)
          else cascadeBuilt(setBuilt, s, s.levels[s.levels.length - 1].level, true)
        }
        return (
          <li key={s.id}>
            <div className={`fir-src-row${all ? ' done' : ''}`}>
              {s.imageLink && (
                <img className="fir-src-ico" src={s.imageLink} alt="" width={26} height={26} loading="lazy" />
              )}
              <span className="fir-src-name">
                {s.name}
                <span className="dim num fir-src-cnt"> · {builtCount}/{total}레벨</span>
                {firLeft && <span className="badge-fir">FIR</span>}
              </span>
              <button
                className={`btn-ext fir-done-btn${all ? ' active' : ''}`}
                onClick={toggleAll}
              >
                {all ? '✓ 건축 완료 · 취소' : '건축 완료'}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------- 루트 ----------

export function FirOps() {
  const state = useAsyncData(async () => {
    const [quests, stations] = await Promise.all([
      fetchQuests(),
      fetchHideoutStations(),
    ])
    const ids = new Set<string>()
    for (const q of quests) for (const n of questFirNeeds(q)) ids.add(n.item.id)
    for (const s of stations)
      for (const lv of s.levels)
        for (const r of lv.items) if (r.fir && !r.isCurrency) ids.add(r.item.id)
    const types = await fetchItemTypes([...ids])
    return { quests, stations, types }
  })

  const { ids: done, toggle: toggleDone } = useIdSet(DONE_QUESTS_KEY)
  const { ids: built, set: setBuilt } = useIdSet(HIDEOUT_BUILT_KEY)
  const { counts, add } = usePrepCounts()

  const [side, setSide] = useState<'quest' | 'hideout'>('quest')
  const [cat, setCat] = useState<DisplayGroupId>('gear')
  const [visible, setVisible] = useState(FIRST_PAINT)

  // 정렬을 마운트 1회로 고정 — 스테퍼 +/−로 타일이 자리를 옮기지 않게 (버그수정).
  // 처음 보는 아이템만 need 내림차순으로 인덱스를 부여하고 이후엔 그 순서를 유지.
  // counts(보유)는 정렬 키에서 완전히 배제 → 수량 조작은 위치에 영향 없음.
  const orderRef = useRef(new Map<string, number>())

  // 우측 수요 도착/분류 전환 시 첫 페인트는 소량 → 전체 (큰 레이아웃 패스 분할)
  useEffect(() => {
    setVisible(FIRST_PAINT)
    if (state.status === 'ready') {
      const t = setTimeout(() => setVisible(Infinity), 60)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, cat])

  // 우측 수요: 완료 안 한 퀘스트 + 안 지은 레벨의 FIR 요구 합산 (보유와 무관)
  const demand = useMemo(() => {
    if (state.status !== 'ready') return [] as DemandItem[]
    const m = new Map<string, DemandItem>()
    const bump = (item: ItemRef, count: number) => {
      let d = m.get(item.id)
      if (!d) {
        d = { item, need: 0, group: displayGroupOf(bucketOf(state.data.types.get(item.id))) }
        m.set(item.id, d)
      }
      d.need += count
    }
    for (const q of state.data.quests) {
      if (done.has(q.id)) continue
      for (const n of questFirNeeds(q)) bump(n.item, n.count)
    }
    for (const s of state.data.stations) {
      for (const lv of s.levels) {
        if (built.has(builtKey(s.id, lv.level))) continue
        for (const r of lv.items) {
          if (r.fir && !r.isCurrency) bump(r.item, r.count)
        }
      }
    }
    return [...m.values()]
  }, [state, done, built])

  // 고정 순서 적용 — demand가 바뀔 때(완료 토글)만 재계산, 보유 변경에는 불변
  const ordered = useMemo(() => {
    const fresh = demand.filter((d) => !orderRef.current.has(d.item.id))
    if (fresh.length) {
      fresh.sort(
        (a, b) => b.need - a.need || collator.compare(a.item.nameKo, b.item.nameKo),
      )
      let n = orderRef.current.size
      for (const d of fresh) orderRef.current.set(d.item.id, n++)
    }
    return [...demand].sort(
      (a, b) =>
        (orderRef.current.get(a.item.id) ?? 0) -
        (orderRef.current.get(b.item.id) ?? 0),
    )
  }, [demand])

  // 분류별 남은 수량 합 (탭 배지)
  const groupRemain = useMemo(() => {
    const out: Record<DisplayGroupId, number> = {
      gear: 0,
      barter: 0,
      food: 0,
      meds: 0,
      etc: 0,
    }
    for (const d of ordered) {
      out[d.group] += Math.max(0, d.need - (counts[d.item.id] ?? 0))
    }
    return out
  }, [ordered, counts])

  if (state.status === 'loading') {
    return (
      <TableSkeleton rows={10} label="퀘스트·은신처 데이터 불러오는 중… (최초 1회, 약 7초)" />
    )
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  // 고정 순서 그대로 분류만 필터 — 보유 기준 재정렬 없음 (위치 유지)
  const catItems = ordered.filter((d) => d.group === cat)
  const shown = catItems.slice(0, visible)

  return (
    <div>
      <p className="hint">
        좌측에서 퀘스트를 <strong>클리어함</strong> / 스테이션을{' '}
        <strong>건축 완료</strong>로 누르면 그 <span className="badge-fir">FIR</span>{' '}
        수요가 우측 정크박스에서 바로 빠집니다. 우측 수량은 클릭이 아니라{' '}
        <strong>− 보유 +</strong> 스테퍼로 직접 조절(준비물 탭과 같은 저장소) — 수량을
        바꿔도 타일 위치는 고정됩니다. 부분 건축은 “트래커·조직도” 보조 보기에서 레벨별로.
      </p>
      <div className="fir-page">
        <section className="fir-left">
          <nav className="mode-seg fir-side-seg" aria-label="소스 선택">
            <button
              className={side === 'quest' ? 'active' : ''}
              onClick={() => setSide('quest')}
            >
              퀘스트
            </button>
            <button
              className={side === 'hideout' ? 'active' : ''}
              onClick={() => setSide('hideout')}
            >
              하이드아웃
            </button>
          </nav>
          {side === 'quest' ? (
            <QuestSource quests={state.data.quests} done={done} onToggle={toggleDone} />
          ) : (
            <HideoutSource
              stations={state.data.stations}
              built={built}
              setBuilt={setBuilt}
            />
          )}
        </section>

        <aside className="fir-right">
          <nav className="mode-seg fir-cat-seg" aria-label="분류 선택">
            {DISPLAY_GROUPS.map((g) => (
              <button
                key={g.id}
                className={cat === g.id ? 'active' : ''}
                onClick={() => setCat(g.id)}
              >
                {g.label}
                {groupRemain[g.id] > 0 && (
                  <span className="dim num"> {formatNumber(groupRemain[g.id])}</span>
                )}
              </button>
            ))}
          </nav>
          {catItems.length === 0 ? (
            <p className="hint">이 분류에 남은 FIR 아이템이 없습니다.</p>
          ) : (
            <div className="fir-grid">
              {shown.map((d) => (
                <FirTile
                  key={d.item.id}
                  d={d}
                  got={counts[d.item.id] ?? 0}
                  onAdd={(delta) => add(d.item.id, delta)}
                />
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
