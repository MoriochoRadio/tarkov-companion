import { useEffect, useMemo, useState } from 'react'
import { CURRENCY_IDS, fetchHideoutRequirements } from '../api/hideout'
import { craftBarterOutputIds, fetchProfitData } from '../api/profit'
import { biName, fetchQuests } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import {
  ACTIVE_QUESTS_KEY,
  DONE_QUESTS_KEY,
  HIDEOUT_BUILT_KEY,
  useIdSet,
} from '../lib/favorites'
import { usePlayerLevel } from '../lib/playerLevel'
import { usePrepCounts } from '../lib/prepCounts'
import { TableSkeleton } from './Skeleton'

const PAGE_SIZE = 60
// 데이터 도착 직후 첫 화면은 소량만 — 저사양 기기에서 큰 레이아웃 패스 1개가
// 수십 초 프리즈로 증폭되는 사고(2026-06-12 퀘스트 탭)를 막는 2단계 렌더
const FIRST_PAINT_ROWS = 20

type Source = 'all' | 'quest' | 'hideout'
type SortKey = 'count' | 'name'

const collator = new Intl.Collator('ko')

// 아이템 하나를 필요로 하는 출처 1건 (퀘스트 목표 또는 은신처 레벨)
interface PrepNeed {
  kind: 'quest' | 'hideout'
  label: string
  count: number
  fir: boolean
  minLevel: number // 퀘스트 수령 가능 레벨 (은신처는 0 = 레벨 무관)
  questId: string | null
  stationKey: string | null // `${stationId}:${level}` — "지었음" 제외용
}

interface PrepRow {
  id: string
  nameKo: string
  nameEn: string
  iconLink: string | null
  searchKey: string
  needs: PrepNeed[]
}

// 화면용: 필터 적용 후 남은 출처와 합계.
// FIR은 퀘스트/은신처 양쪽에 있을 수 있어(1.0) 출처별로 따로 센다
interface PrepView extends PrepRow {
  total: number
  questFir: number
  questNorm: number
  hideoutFir: number
  hideoutNorm: number
}

function buildRows(
  quests: Awaited<ReturnType<typeof fetchQuests>>,
  hideout: Awaited<ReturnType<typeof fetchHideoutRequirements>>,
): PrepRow[] {
  const map = new Map<string, PrepRow>()
  const row = (item: {
    id: string
    nameKo: string
    nameEn: string
    iconLink: string | null
  }): PrepRow => {
    let r = map.get(item.id)
    if (!r) {
      r = {
        ...item,
        searchKey: `${item.nameKo} ${item.nameEn}`.toLowerCase(),
        needs: [],
      }
      map.set(item.id, r)
    }
    return r
  }

  // 퀘스트: 제출(giveItem)·설치(plantItem)로 소모되는 단일 아이템 목표만.
  // "여러 아이템 중 아무거나" 선택형 목표는 특정 아이템을 지목할 수 없어 제외.
  // findItem은 같은 퀘스트의 giveItem과 짝이라 세면 이중 계산이 됨 → 제외
  for (const q of quests) {
    for (const o of q.objectives) {
      if (o.type !== 'giveItem' && o.type !== 'plantItem') continue
      if (o.items?.length !== 1) continue
      if (CURRENCY_IDS.has(o.items[0].id)) continue // 돈 제출형 퀘스트 제외
      row(o.items[0]).needs.push({
        kind: 'quest',
        label: q.displayName,
        count: o.count ?? 1,
        fir: o.foundInRaid === true,
        minLevel: q.minPlayerLevel,
        questId: q.id,
        stationKey: null,
      })
    }
  }

  for (const h of hideout) {
    row(h.item).needs.push({
      kind: 'hideout',
      label: `${h.stationName} ${h.level}레벨`,
      count: h.count,
      fir: h.fir, // 1.0부터 은신처 요구도 일부는 FIR만 인정
      minLevel: 0,
      questId: null,
      stationKey: `${h.stationId}:${h.level}`,
    })
  }
  return [...map.values()]
}

// 행 1개 — 펼치면 출처별 상세, +/−로 모은 개수 기록
function PrepRowView({
  view,
  got,
  expanded,
  onToggle,
  onAdd,
  onItem,
  onQuest,
  craftable,
  onProfit,
}: {
  view: PrepView
  got: number
  expanded: boolean
  onToggle: () => void
  onAdd: (delta: number) => void
  onItem?: (name: string) => void // 시세(검색) 딥링크
  onQuest?: (id: string) => void // 출처 퀘스트 상세 딥링크
  craftable?: boolean // 제작/바터로 나오는 아이템인지 (Phase 41)
  onProfit?: (id: string) => void // 돈벌이(제작·바터) 딥링크
}) {
  const done = got >= view.total
  const pct = Math.min(100, Math.round((got / view.total) * 100))
  return (
    <li className={`prep-row${done ? ' done' : ''}`}>
      <button className="prep-main" onClick={onToggle} aria-expanded={expanded}>
        {view.iconLink && <img src={view.iconLink} alt="" loading="lazy" />}
        <span className="prep-name">
          <span className="prep-title">{biName(view.nameKo, view.nameEn)}</span>
          <span className="prep-chips">
            {view.questFir > 0 && (
              <span className="badge-fir">퀘 FIR {view.questFir}</span>
            )}
            {view.questNorm > 0 && (
              <span className="prep-chip">퀘스트 {view.questNorm}</span>
            )}
            {view.hideoutFir > 0 && (
              <span className="badge-fir">은신처 FIR {view.hideoutFir}</span>
            )}
            {view.hideoutNorm > 0 && (
              <span className="prep-chip">은신처 {view.hideoutNorm}</span>
            )}
          </span>
        </span>
        <span className="prep-arrow" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      <span className="prep-counter">
        <button
          className="prep-step"
          onClick={() => onAdd(-1)}
          disabled={got === 0}
          aria-label="모은 개수 빼기"
        >
          −
        </button>
        <span className="num prep-progress-num">
          {got}
          <span className="dim">/{view.total}</span>
        </span>
        <button className="prep-step" onClick={() => onAdd(1)} aria-label="모은 개수 더하기">
          +
        </button>
      </span>
      <span className="prep-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      {expanded && (
        <ul className="prep-needs">
          {view.needs.map((n, i) => {
            const inner = (
              <>
                <span className={n.kind === 'quest' ? 'prep-kind quest' : 'prep-kind'}>
                  {n.kind === 'quest' ? '퀘스트' : '은신처'}
                </span>
                {n.label}
                {n.kind === 'quest' && n.minLevel > 1 && (
                  <span className="dim"> (레벨 {n.minLevel}+)</span>
                )}
                <span className="num"> × {n.count}</span>
                {n.fir && <span className="badge-fir">FIR</span>}
              </>
            )
            // 퀘스트 출처는 클릭 → 그 퀘스트 상세(목표·맵 = 어디서 파밍)로 이동
            return (
              <li key={i}>
                {n.kind === 'quest' && n.questId && onQuest ? (
                  <button
                    className="prep-need-link"
                    onClick={() => onQuest(n.questId!)}
                    title="이 퀘스트 상세 보기 (목표·맵)"
                  >
                    <span className="prep-need-body">{inner}</span>
                    <span className="prep-need-go" aria-hidden>
                      →
                    </span>
                  </button>
                ) : (
                  inner
                )}
              </li>
            )
          })}
          {(onItem || (craftable && onProfit)) && (
            <li className="prep-acts">
              {onItem && (
                <button
                  className="prep-act"
                  onClick={() => onItem(view.nameKo)}
                  title="아이템 검색 — 시세·구매처·수익성"
                >
                  🔍 시세·구매처
                </button>
              )}
              {craftable && onProfit && (
                <button
                  className="prep-act"
                  onClick={() => onProfit(view.id)}
                  title="돈벌이 탭 — 이 아이템을 만들거나 바터로 얻는 레시피"
                >
                  🔁 제작·바터
                </button>
              )}
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

// 통합 필요템 체크리스트 — 퀘스트 제출 + 은신처 건설 수요 집계 + 모은 개수 기록.
// "내 진행" 탭(FirTab)의 기본 전면 뷰 (Phase 38). 펼친 행에서 시세·퀘스트 딥링크.
export function PrepChecklist({
  onItem,
  onQuest,
  onProfit,
}: {
  onItem?: (name: string) => void
  onQuest?: (id: string) => void
  onProfit?: (id: string) => void
}) {
  const state = useAsyncData(() =>
    Promise.all([fetchQuests(), fetchHideoutRequirements()]),
  )
  // 제작·바터 인덱스는 별도 로드 — 체크리스트 첫 페인트를 막지 않게(링크만 나중에 채움)
  const profitState = useAsyncData(fetchProfitData)
  const [query, setQuery] = useState('')
  const [level, setLevel] = usePlayerLevel()
  const [source, setSource] = useState<Source>('all')
  const [firOnly, setFirOnly] = useState(false)
  const [activeOnly, setActiveOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('count')
  const [visible, setVisible] = useState(FIRST_PAINT_ROWS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { ids: activeIds } = useIdSet(ACTIVE_QUESTS_KEY)
  const { ids: doneIds } = useIdSet(DONE_QUESTS_KEY)
  const { ids: builtLevels } = useIdSet(HIDEOUT_BUILT_KEY)
  const { counts, add } = usePrepCounts()

  // 첫 페인트 후 한 페이지 분량으로 확장 (QuestsTab과 같은 2단계 렌더)
  useEffect(() => {
    if (state.status === 'ready' && visible < PAGE_SIZE) {
      const t = setTimeout(() => setVisible(PAGE_SIZE), 50)
      return () => clearTimeout(t)
    }
    // visible은 의도적으로 제외 — 확장은 데이터 도착 후 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  // 제작/바터로 나오는 아이템 id — "🔁 제작·바터" 딥링크를 그런 아이템에만 노출
  const craftableIds = useMemo(
    () =>
      profitState.status === 'ready'
        ? craftBarterOutputIds(profitState.data)
        : new Set<string>(),
    [profitState],
  )

  const allRows = useMemo(
    () => (state.status === 'ready' ? buildRows(state.data[0], state.data[1]) : []),
    [state],
  )

  const views = useMemo(() => {
    const q = query.trim().toLowerCase()
    const lvl = Number(level)
    const out: PrepView[] = []
    for (const r of allRows) {
      if (q && !r.searchKey.includes(q)) continue
      let needs = r.needs
      // 은신처 뷰에서 "지었음"으로 표시한 레벨의 몫은 더 모을 필요 없음
      needs = needs.filter((n) => !n.stationKey || !builtLevels.has(n.stationKey))
      // 완료(✓)한 퀘스트의 제출 몫도 제외 — 어느 탭에서든 완료 처리하면 여기서 빠짐
      needs = needs.filter((n) => n.questId == null || !doneIds.has(n.questId))
      if (source === 'quest') needs = needs.filter((n) => n.kind === 'quest')
      if (source === 'hideout') needs = needs.filter((n) => n.kind === 'hideout')
      // "진행 중만"은 퀘스트 기준 필터 — 은신처 몫은 같이 숨김 (지금 할 일 뷰)
      if (activeOnly) {
        needs = needs.filter((n) => n.questId != null && activeIds.has(n.questId))
      }
      if (level) {
        needs = needs.filter((n) => n.kind !== 'quest' || n.minLevel <= lvl)
      }
      if (firOnly) needs = needs.filter((n) => n.fir)
      if (needs.length === 0) continue
      let total = 0
      let questFir = 0
      let questNorm = 0
      let hideoutFir = 0
      let hideoutNorm = 0
      for (const n of needs) {
        total += n.count
        if (n.kind === 'quest') {
          if (n.fir) questFir += n.count
          else questNorm += n.count
        } else {
          if (n.fir) hideoutFir += n.count
          else hideoutNorm += n.count
        }
      }
      out.push({ ...r, needs, total, questFir, questNorm, hideoutFir, hideoutNorm })
    }
    out.sort((a, b) =>
      sortKey === 'count'
        ? b.total - a.total || collator.compare(a.nameKo, b.nameKo)
        : collator.compare(a.nameKo, b.nameKo),
    )
    return out
  }, [allRows, query, level, source, firOnly, activeOnly, activeIds, doneIds, builtLevels, sortKey])

  // 다 모은 아이템은 아래 접힘 섹션으로 — 진행 중 목록을 짧게 유지
  const { todo, doneRows, gotSum, needSum } = useMemo(() => {
    const todo: PrepView[] = []
    const doneRows: PrepView[] = []
    let gotSum = 0
    let needSum = 0
    for (const v of views) {
      const got = counts[v.id] ?? 0
      gotSum += Math.min(got, v.total)
      needSum += v.total
      if (got >= v.total) doneRows.push(v)
      else todo.push(v)
    }
    return { todo, doneRows, gotSum, needSum }
  }, [views, counts])

  if (state.status === 'loading') {
    return (
      <TableSkeleton rows={10} label="퀘스트·은신처 데이터 불러오는 중… (최초 1회, 약 7초)" />
    )
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  const shown = todo.slice(0, visible)
  const pct = needSum > 0 ? Math.round((gotSum / needSum) * 100) : 0

  return (
    <div>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="아이템 이름 검색 (한국어/영어)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setVisible(PAGE_SIZE)
          }}
        />
        <input
          className="level-input"
          type="number"
          min="1"
          max="79"
          placeholder="내 레벨"
          value={level}
          onChange={(e) => {
            setLevel(e.target.value)
            setVisible(PAGE_SIZE)
          }}
        />
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value as Source)
            setVisible(PAGE_SIZE)
          }}
        >
          <option value="all">퀘스트 + 은신처</option>
          <option value="quest">퀘스트만</option>
          <option value="hideout">은신처만</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="count">필요 수량순</option>
          <option value="name">이름순</option>
        </select>
        <label className="toggle">
          <input
            type="checkbox"
            checked={firOnly}
            onChange={(e) => {
              setFirOnly(e.target.checked)
              setVisible(PAGE_SIZE)
            }}
          />
          FIR만
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked)
              setVisible(PAGE_SIZE)
            }}
          />
          ★ 진행 중 퀘스트만
        </label>
      </div>
      <p className="hint">
        레이드에서 버리거나 팔면 안 되는 아이템 — 퀘스트 제출 + 은신처 건설 수요
        집계 · FIR = 레이드 획득(체크 표시)만 인정, 1.0부터 은신처 일부 요구에도
        적용 · +/−로 모은 개수를 기록 (이 브라우저에 저장) · 은신처 뷰에서
        “지었음” 표시한 레벨 몫은 자동 제외 · “여러 아이템 중 하나” 선택형 목표와
        화폐는 제외 · 내 레벨을 입력하면 그 레벨에 받을 수 있는 퀘스트만 집계 ·
        행을 펼치면 <b>출처 퀘스트</b>를 눌러 상세(목표·맵)로, <b>🔍 시세·구매처</b>로
        검색 탭(가격·구매처·수익성)으로 바로 이동
      </p>

      <div className="prep-summary">
        <span className="prep-bar prep-bar-lg" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="num">
          {pct}% <span className="dim">· {gotSum.toLocaleString('ko-KR')}/{needSum.toLocaleString('ko-KR')}개 · 완료 {doneRows.length}/{views.length}종</span>
        </span>
      </div>

      {views.length === 0 && (
        <p className="hint">
          {activeOnly
            ? '진행 중으로 표시한 퀘스트가 없습니다 — 퀘스트 탭에서 ☆를 눌러 추가하세요.'
            : '조건에 맞는 아이템이 없습니다.'}
        </p>
      )}

      <ul className="prep-list">
        {shown.map((v) => (
          <PrepRowView
            key={v.id}
            view={v}
            got={counts[v.id] ?? 0}
            expanded={expandedId === v.id}
            onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
            onAdd={(d) => add(v.id, d)}
            onItem={onItem}
            onQuest={onQuest}
            craftable={craftableIds.has(v.id)}
            onProfit={onProfit}
          />
        ))}
      </ul>
      {todo.length > visible && (
        <button className="load-more" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
          더 보기 ({todo.length - visible}개 남음)
        </button>
      )}

      {doneRows.length > 0 && (
        <details className="prep-done">
          <summary>✓ 다 모음 ({doneRows.length}종)</summary>
          <ul className="prep-list">
            {doneRows.map((v) => (
              <PrepRowView
                key={v.id}
                view={v}
                got={counts[v.id] ?? 0}
                expanded={expandedId === v.id}
                onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
                onAdd={(d) => add(v.id, d)}
                onItem={onItem}
                onQuest={onQuest}
                craftable={craftableIds.has(v.id)}
                onProfit={onProfit}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
