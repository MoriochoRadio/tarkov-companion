import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CURRENCY_IDS,
  fetchHideoutStations,
  type HideoutStation,
} from '../api/hideout'
import { biName, fetchQuests, type Quest } from '../api/quests'
import { fetchStoryline } from '../api/storyline'
import { useAsyncData } from '../hooks/useAsyncData'
import {
  ACTIVE_QUESTS_KEY,
  HIDEOUT_BUILT_KEY,
  STORY_DONE_KEY,
  useIdSet,
} from '../lib/favorites'
import { formatNumber } from '../lib/format'
import { usePlayerLevel } from '../lib/playerLevel'
import { usePrepCounts } from '../lib/prepCounts'
import { builtKey, cascadeBuilt } from './HideoutView'
import { TableSkeleton } from './Skeleton'

// FIR 트래커 (Phase 24) — 친구 스케치 구현: 좌측 퀘스트/스테이션 목록에서
// 아이템을 클릭해 "모았음"을 기록하면 우측 정크박스 그리드의 남은 수량이
// 실시간으로 줄어든다. 보유 개수는 준비물 탭의 +/−와 같은 저장소
// (tc:prep-counts) 하나만 사용 — 이중 관리 금지. 준비물 = 통합 요약,
// 트래커 = 상인·스테이션별 상세 뷰로 공존.

const JUNK_FIRST_PAINT = 40 // 아이콘 다수 그리드는 2단계 렌더 (Phase 17 교훈)
const QUEST_FIRST_PAINT = 12 // 좌측 퀘스트 목록도 동일 — 트레이더 전환마다 적용

const collator = new Intl.Collator('ko')

interface JunkRef {
  id: string
  nameKo: string
  nameEn: string
  iconLink: string | null
}

interface JunkNeed {
  label: string
  count: number
  fir: boolean
}

interface JunkItem {
  item: JunkRef
  total: number
  firTotal: number
  needs: JunkNeed[]
}

// ---------- 정크박스 그리드 (퀘스트/은신처 공용) ----------

function JunkTile({
  j,
  got,
  onAdd,
}: {
  j: JunkItem
  got: number
  onAdd: (delta: number) => void
}) {
  const remaining = Math.max(0, j.total - got)
  const full = remaining === 0
  const name = biName(j.item.nameKo, j.item.nameEn)
  const needLines = j.needs
    .slice(0, 6)
    .map((n) => `${n.label} ×${n.count}${n.fir ? ' (FIR)' : ''}`)
    .join('\n')
  return (
    <span className={`junk-tile${full ? ' full' : ''}`}>
      <button
        className="junk-hit"
        onClick={() => !full && onAdd(1)}
        title={`${name}\n필요 ${j.total} · 보유 ${got} · 남음 ${remaining}\n${needLines}${
          j.needs.length > 6 ? '\n…' : ''
        }`}
        aria-label={`${name} — 남음 ${remaining}개, 클릭하면 모은 개수 +1`}
      >
        {j.item.iconLink && <img src={j.item.iconLink} alt="" loading="lazy" />}
        <span className="junk-count num">{full ? '✓' : `×${remaining}`}</span>
        {j.firTotal > 0 && <span className="qtile-fir">FIR</span>}
      </button>
      {got > 0 && (
        <button
          className="junk-minus"
          onClick={() => onAdd(-1)}
          aria-label={`${name} 모은 개수 하나 되돌리기`}
          title="하나 되돌리기 (−1)"
        >
          −
        </button>
      )}
    </span>
  )
}

function JunkboxGrid({ title, items }: { title: string; items: JunkItem[] }) {
  const { counts, add } = usePrepCounts()
  const [visible, setVisible] = useState(JUNK_FIRST_PAINT)

  // 첫 페인트는 소량만 → 직후 전체 (2단계 렌더)
  useEffect(() => {
    if (visible <= JUNK_FIRST_PAINT) {
      const t = setTimeout(() => setVisible(Infinity), 60)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const live: JunkItem[] = []
  const done: JunkItem[] = []
  let remainSum = 0
  for (const j of items) {
    const got = counts[j.item.id] ?? 0
    const rem = Math.max(0, j.total - got)
    remainSum += rem
    if (rem === 0) done.push(j)
    else live.push(j)
  }

  return (
    <div className="junkbox">
      <header className="junkbox-head">
        <h3>{title}</h3>
        <span className="dim num">남음 {formatNumber(remainSum)}개</span>
      </header>
      {items.length === 0 && <p className="hint">조건에 맞는 아이템이 없습니다.</p>}
      <div className="junk-grid">
        {live.slice(0, visible).map((j) => (
          <JunkTile
            key={j.item.id}
            j={j}
            got={counts[j.item.id] ?? 0}
            onAdd={(d) => add(j.item.id, d)}
          />
        ))}
      </div>
      {done.length > 0 && (
        <details className="prep-done">
          <summary>✓ 다 모음 ({done.length}종)</summary>
          <div className="junk-grid">
            {done.map((j) => (
              <JunkTile
                key={j.item.id}
                j={j}
                got={counts[j.item.id] ?? 0}
                onAdd={(d) => add(j.item.id, d)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ---------- 퀘스트 FIR 트래커 ----------

interface TrackNeed {
  item: JunkRef
  count: number
  fir: boolean
}

interface TrackQuest {
  quest: Quest
  needs: TrackNeed[]
}

function questNeeds(quest: Quest): TrackNeed[] {
  // 준비물 탭과 같은 집계 규칙: 제출/설치 단일 아이템 목표만, 화폐 제외
  return quest.objectives
    .filter(
      (o) =>
        (o.type === 'giveItem' || o.type === 'plantItem') &&
        o.items?.length === 1 &&
        !CURRENCY_IDS.has(o.items[0].id),
    )
    .map((o) => ({
      item: o.items![0],
      count: o.count ?? 1,
      fir: o.foundInRaid === true,
    }))
}

// 좌측 목록의 아이템 칩 — 클릭하면 +1, 보유가 있으면 붙어있는 −1로 그 자리에서
// 되돌린다. 우측 정크박스에서만 −1 되던 시절엔 오클릭 복구가 어려웠음(피드백 반영).
function TrackChip({
  item,
  count,
  fir,
  got,
  onAdd,
}: {
  item: JunkRef
  count: number
  fir: boolean
  got: number
  onAdd: (delta: number) => void
}) {
  const name = biName(item.nameKo, item.nameEn)
  return (
    <span className={`tk-chip-wrap${got > 0 ? ' has-minus' : ''}`}>
      <button
        className="item-chip tk-item"
        onClick={() => onAdd(1)}
        title={`${name} — 클릭하면 모은 개수 +1 (보유 ${got})`}
      >
        {item.iconLink && <img src={item.iconLink} alt="" loading="lazy" />}
        <span>
          {name}
          <span className="num"> × {count}</span>
        </span>
        {fir && <span className="badge-fir">FIR</span>}
        {got > 0 && <span className="num hideout-have">보유 {got}</span>}
      </button>
      {got > 0 && (
        <button
          className="tk-chip-minus"
          onClick={() => onAdd(-1)}
          aria-label={`${name} 모은 개수 하나 되돌리기 (−1)`}
          title="하나 되돌리기 (−1)"
        >
          −
        </button>
      )}
    </span>
  )
}

// 스토리라인 선택 시 — 챕터엔 API 아이템 데이터가 없어 정크박스 집계 불가.
// 구분 방식 선택 사유: 카파 필수 여부는 "수집가" 사이드 라인 표식이라 스토리
// 구분이 아님 → Phase 21의 수동 큐레이션 파일(storyline.json)을 재사용
function StoryPanel() {
  const state = useAsyncData(fetchStoryline)
  const { ids: doneIds } = useIdSet(STORY_DONE_KEY)
  if (state.status === 'loading') {
    return <TableSkeleton rows={5} label="스토리라인 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }
  return (
    <div>
      <p className="hint">
        1.0 메인 스토리 챕터 — 진행 순서대로. 챕터의 제출 아이템은 tarkov.dev
        API에 없어(위키 기반 수동 데이터만 존재) 정크박스 집계 대상이 아닙니다.
        공략·완료 체크는 퀘스트 탭 → 스토리라인에서.
      </p>
      <ol className="tk-story-list">
        {state.data.chapters.map((c) => (
          <li key={c.slug} className={doneIds.has(c.slug) ? 'done' : ''}>
            <span className="num tk-story-order">{c.order}</span>
            <span>
              {c.nameKo}
              <span className="dim"> ({c.nameEn})</span>
              {c.final && <span className="badge-kappa">엔딩</span>}
            </span>
            {doneIds.has(c.slug) && <span className="hideout-built-badge">✓ 완료</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

function QuestTracker() {
  const state = useAsyncData(fetchQuests)
  const [traderId, setTraderId] = useState<string | null>(null)
  const [storyMode, setStoryMode] = useState(false)
  const [level, setLevel] = usePlayerLevel()
  const [firOnly, setFirOnly] = useState(true)
  const [activeOnly, setActiveOnly] = useState(false)
  const { ids: activeIds } = useIdSet(ACTIVE_QUESTS_KEY)
  const { counts, add } = usePrepCounts()

  // 트레이더 → 제출 아이템이 있는 퀘스트 (레벨 오름차순)
  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    const lvl = Number(level)
    const byTrader = new Map<
      string,
      { trader: Quest['trader']; quests: TrackQuest[] }
    >()
    for (const quest of state.data) {
      if (level && quest.minPlayerLevel > lvl) continue
      if (activeOnly && !activeIds.has(quest.id)) continue
      let needs = questNeeds(quest)
      if (firOnly) needs = needs.filter((n) => n.fir)
      if (needs.length === 0) continue
      let g = byTrader.get(quest.trader.id)
      if (!g) {
        g = { trader: quest.trader, quests: [] }
        byTrader.set(quest.trader.id, g)
      }
      g.quests.push({ quest, needs })
    }
    const out = [...byTrader.values()]
    for (const g of out) {
      g.quests.sort(
        (a, b) =>
          a.quest.minPlayerLevel - b.quest.minPlayerLevel ||
          collator.compare(a.quest.nameKo, b.quest.nameKo),
      )
    }
    return out.sort((a, b) => b.quests.length - a.quests.length)
  }, [state, level, firOnly, activeOnly, activeIds])

  const selected =
    groups.find((g) => g.trader.id === traderId) ?? groups[0] ?? null

  // 트레이더 전환마다 목록을 소량 → 전체 2단계로 (큰 레이아웃 패스 분할)
  const [qVisible, setQVisible] = useState(QUEST_FIRST_PAINT)
  const selectedTraderId = selected?.trader.id ?? null
  useEffect(() => {
    setQVisible(QUEST_FIRST_PAINT)
    const t = setTimeout(() => setQVisible(Infinity), 60)
    return () => clearTimeout(t)
  }, [selectedTraderId])

  // 우측 정크박스: 선택한 상인의 필요 아이템 합산
  const junkItems = useMemo(() => {
    if (!selected) return []
    const byItem = new Map<string, JunkItem>()
    for (const { quest, needs } of selected.quests) {
      for (const n of needs) {
        let j = byItem.get(n.item.id)
        if (!j) {
          j = { item: n.item, total: 0, firTotal: 0, needs: [] }
          byItem.set(n.item.id, j)
        }
        j.total += n.count
        if (n.fir) j.firTotal += n.count
        j.needs.push({ label: quest.nameKo, count: n.count, fir: n.fir })
      }
    }
    return [...byItem.values()].sort((a, b) => b.total - a.total)
  }, [selected])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="퀘스트 데이터 불러오는 중… (최초 1회, 약 7초)" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  return (
    <div>
      <div className="toolbar">
        <input
          className="level-input"
          type="number"
          min="1"
          max="79"
          placeholder="내 레벨"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={firOnly}
            onChange={(e) => setFirOnly(e.target.checked)}
          />
          <span className="badge-fir">FIR</span>만
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          ★ 진행 중만
        </label>
      </div>
      <p className="hint">
        상인을 고르고 퀘스트의 아이템을 클릭하면 모은 개수 +1 — 우측 정크박스의
        남은 수량이 바로 줄어듭니다. 잘못 눌렀으면 칩 오른쪽 −로 바로 되돌리세요.
        보유 개수는 준비물 탭 +/−와 같은 저장소
        (계정 전체 기준) — 상인별 남은 수량은 보유분을 그 상인에 모두 쓴다고
        가정한 표시입니다.
      </p>

      {/* 상인 선택 줄 — 스토리라인은 맨 끝 (챕터 순서 보기) */}
      <div className="tk-traders" role="tablist" aria-label="상인 선택">
        {groups.map((g) => (
          <button
            key={g.trader.id}
            role="tab"
            aria-selected={!storyMode && selected?.trader.id === g.trader.id}
            className={`tk-trader${
              !storyMode && selected?.trader.id === g.trader.id ? ' active' : ''
            }`}
            onClick={() => {
              setStoryMode(false)
              setTraderId(g.trader.id)
            }}
          >
            {g.trader.imageLink && (
              <img src={g.trader.imageLink} alt="" width={40} height={40} loading="lazy" />
            )}
            <span>{g.trader.name}</span>
            <span className="dim num">{g.quests.length}</span>
          </button>
        ))}
        <button
          role="tab"
          aria-selected={storyMode}
          className={`tk-trader${storyMode ? ' active' : ''}`}
          onClick={() => setStoryMode(true)}
        >
          <span className="tk-story-glyph" aria-hidden>
            §
          </span>
          <span>스토리라인</span>
        </button>
      </div>

      {storyMode ? (
        <StoryPanel />
      ) : selected ? (
        <div className="tracker-split">
          <div className="tracker-left">
            <ul className="tk-quests">
              {selected.quests.slice(0, qVisible).map(({ quest, needs }) => (
                <li key={quest.id} className="tk-quest">
                  <p className="tk-quest-head">
                    <span className="dim num">Lv {quest.minPlayerLevel}</span>
                    <span className="tk-quest-name">{quest.displayName}</span>
                    {quest.kappaRequired && <span className="badge-kappa">κ</span>}
                  </p>
                  <p className="chip-row">
                    {needs.map((n, i) => (
                      <TrackChip
                        key={`${n.item.id}-${i}`}
                        item={n.item}
                        count={n.count}
                        fir={n.fir}
                        got={counts[n.item.id] ?? 0}
                        onAdd={(d) => add(n.item.id, d)}
                      />
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <aside className="tracker-right">
            <JunkboxGrid
              title={`${selected.trader.name} 정크박스`}
              items={junkItems}
            />
          </aside>
        </div>
      ) : (
        <p className="hint">조건에 맞는 퀘스트가 없습니다.</p>
      )}
    </div>
  )
}

// ---------- 은신처 FIR 트래커 ----------

interface TreeModel {
  layers: HideoutStation[][]
  edges: { from: string; to: string }[]
}

// 조직도 층 = 스테이션 1레벨의 레벨 단위 DAG 깊이.
// 스테이션 단위 그래프엔 순환이 있어(발전기↔환기 실측) 층 계산에 못 쓰고,
// 레벨 단위는 DAG임이 Phase 21 위상 정렬(위반 0)로 확인돼 있다
function buildTreeModel(stations: HideoutStation[]): TreeModel {
  const lvKey = (id: string, level: number) => `${id}:${level}`
  const deps = new Map<string, string[]>()
  for (const s of stations) {
    for (const lv of s.levels) {
      const d: string[] = []
      if (lv.level > 1) d.push(lvKey(s.id, lv.level - 1))
      for (const r of lv.stationRequirements) d.push(lvKey(r.stationId, r.level))
      deps.set(lvKey(s.id, lv.level), d)
    }
  }
  const memo = new Map<string, number>()
  const depth = (k: string, seen: Set<string>): number => {
    const m = memo.get(k)
    if (m !== undefined) return m
    if (seen.has(k) || !deps.has(k)) return 0
    seen.add(k)
    const ds = deps.get(k)!
    const d = ds.length ? 1 + Math.max(...ds.map((x) => depth(x, seen))) : 0
    memo.set(k, d)
    return d
  }

  const byDepth = new Map<number, HideoutStation[]>()
  for (const s of stations) {
    const d = depth(lvKey(s.id, 1), new Set())
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(s)
  }
  const layers = [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list.sort((a, b) => collator.compare(a.name, b.name)))

  // 간선: 스테이션 단위로 중복 제거 (자기 자신 레벨 간 의존 제외)
  const edgeSet = new Set<string>()
  const edges: TreeModel['edges'] = []
  for (const s of stations) {
    for (const lv of s.levels) {
      for (const r of lv.stationRequirements) {
        if (r.stationId === s.id) continue
        const k = `${r.stationId}>${s.id}`
        if (edgeSet.has(k)) continue
        edgeSet.add(k)
        edges.push({ from: r.stationId, to: s.id })
      }
    }
  }
  return { layers, edges }
}

function HideoutTree({
  stations,
  built,
  firNeed,
  selectedId,
  onSelect,
}: {
  stations: HideoutStation[]
  built: ReadonlySet<string>
  firNeed: ReadonlySet<string> // 아직 안 지은 레벨에 FIR 요구가 있는 스테이션
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const model = useMemo(() => buildTreeModel(stations), [stations])
  const wrapRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>())
  const [paths, setPaths] = useState<
    { from: string; to: string; d: string }[]
  >([])
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 })

  // 노드 위치 실측 → 연결선 경로. transform/스크롤에 영향받지 않게
  // 컨테이너 기준 좌표로 계산. 리사이즈(랩 변동 포함) 시 재계산
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current
      if (!wrap) return
      const base = wrap.getBoundingClientRect()
      const next: { from: string; to: string; d: string }[] = []
      for (const e of model.edges) {
        const a = nodeRefs.current.get(e.from)?.getBoundingClientRect()
        const b = nodeRefs.current.get(e.to)?.getBoundingClientRect()
        if (!a || !b) continue
        const x1 = a.left + a.width / 2 - base.left
        const y1 = a.bottom - base.top
        const x2 = b.left + b.width / 2 - base.left
        const y2 = b.top - base.top
        const bend = Math.max(14, Math.abs(y2 - y1) / 2)
        next.push({
          ...e,
          d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`,
        })
      }
      setPaths(next)
      setSvgSize({ w: wrap.scrollWidth, h: wrap.scrollHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [model])

  const doneCount = (s: HideoutStation) =>
    s.levels.filter((lv) => built.has(builtKey(s.id, lv.level))).length

  return (
    <div className="htree" ref={wrapRef}>
      {/* 연결선은 평소 흐리게, 선택한 스테이션과 닿은 선만 골드 강조 */}
      <svg
        className="htree-edges"
        width={svgSize.w}
        height={svgSize.h}
        aria-hidden
      >
        {paths.map((p) => (
          <path
            key={`${p.from}>${p.to}`}
            className={
              selectedId && (p.from === selectedId || p.to === selectedId)
                ? 'on'
                : ''
            }
            d={p.d}
          />
        ))}
      </svg>
      {model.layers.map((row, i) => (
        <div className="htree-row" key={i}>
          {row.map((s) => {
            const done = doneCount(s)
            const all = done === s.levels.length
            return (
              <button
                key={s.id}
                ref={(el) => {
                  if (el) nodeRefs.current.set(s.id, el)
                  else nodeRefs.current.delete(s.id)
                }}
                className={`htree-node${s.id === selectedId ? ' active' : ''}${
                  all ? ' done' : ''
                }`}
                onClick={() => onSelect(s.id)}
                aria-pressed={s.id === selectedId}
              >
                {s.imageLink && <img src={s.imageLink} alt="" />}
                <span className="htree-name">{s.name}</span>
                <span className="num htree-progress">
                  {done}/{s.levels.length}
                </span>
                {firNeed.has(s.id) && (
                  <span className="htree-fir" title="안 지은 레벨에 FIR 요구 있음">
                    FIR
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function HideoutTracker() {
  const state = useAsyncData(fetchHideoutStations)
  const { ids: built, set } = useIdSet(HIDEOUT_BUILT_KEY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [firOnly, setFirOnly] = useState(true)
  const { counts, add } = usePrepCounts()

  const stations = state.status === 'ready' ? state.data : []

  // 우측 정크박스: 아직 안 지은 레벨의 요구만 (화폐 제외)
  const junkItems = useMemo(() => {
    const byItem = new Map<string, JunkItem>()
    for (const s of stations) {
      for (const lv of s.levels) {
        if (built.has(builtKey(s.id, lv.level))) continue
        for (const r of lv.items) {
          if (r.isCurrency) continue
          if (firOnly && !r.fir) continue
          let j = byItem.get(r.item.id)
          if (!j) {
            j = { item: r.item, total: 0, firTotal: 0, needs: [] }
            byItem.set(r.item.id, j)
          }
          j.total += r.count
          if (r.fir) j.firTotal += r.count
          j.needs.push({
            label: `${s.name} ${lv.level}레벨`,
            count: r.count,
            fir: r.fir,
          })
        }
      }
    }
    return [...byItem.values()].sort((a, b) => b.total - a.total)
  }, [stations, built, firOnly])

  // 트리 노드의 FIR 점 표시용
  const firNeed = useMemo(() => {
    const out = new Set<string>()
    for (const s of stations) {
      for (const lv of s.levels) {
        if (built.has(builtKey(s.id, lv.level))) continue
        if (lv.items.some((r) => r.fir)) out.add(s.id)
      }
    }
    return out
  }, [stations, built])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="은신처 데이터 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  const selected = stations.find((s) => s.id === selectedId) ?? null

  return (
    <div>
      <div className="toolbar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={firOnly}
            onChange={(e) => setFirOnly(e.target.checked)}
          />
          정크박스 <span className="badge-fir">FIR</span>만
        </label>
      </div>
      <p className="hint">
        선행 관계 조직도 — 위에서 아래로 갈수록 늦게 풀리는 스테이션, 선택하면
        그 스테이션과 닿은 연결선이 강조됩니다. 스테이션을 눌러 레벨별 필요
        아이템을 클릭하면 우측 정크박스에서 차감 · “지었음” 레벨 몫은 집계에서
        자동 제외 (준비물 탭과 같은 저장소)
      </p>
      <div className="tracker-split">
        <div className="tracker-left">
          <HideoutTree
            stations={stations}
            built={built}
            firNeed={firNeed}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
          />
          {selected && (
            <div className="tk-station-panel">
              <h3 className="station-detail-title">
                {selected.imageLink && <img src={selected.imageLink} alt="" />}
                {selected.name}
              </h3>
              {selected.levels.map((lv) => {
                const b = built.has(builtKey(selected.id, lv.level))
                return (
                  <section
                    key={lv.level}
                    className={`tk-level${b ? ' built' : ''}`}
                  >
                    <header className="tk-level-head">
                      <strong>{lv.level}레벨</strong>
                      {lv.stationRequirements.map((r) => (
                        <span key={r.stationId} className="prep-chip">
                          {r.name} {r.level}레벨
                        </span>
                      ))}
                      <button
                        className={`btn-ext bo-toggle${b ? ' active' : ''}`}
                        onClick={() => cascadeBuilt(set, selected, lv.level, !b)}
                      >
                        {b ? '✓ 건설됨 · 취소' : '지었음'}
                      </button>
                    </header>
                    <p className="chip-row">
                      {lv.items.map((r, i) =>
                        r.isCurrency ? (
                          <span key={`${r.item.id}-${i}`} className="item-chip tk-currency">
                            <span>
                              {r.item.nameKo}
                              <span className="num"> ₽ {formatNumber(r.count)}</span>
                            </span>
                          </span>
                        ) : (
                          <TrackChip
                            key={`${r.item.id}-${i}`}
                            item={r.item}
                            count={r.count}
                            fir={r.fir}
                            got={counts[r.item.id] ?? 0}
                            onAdd={(d) => add(r.item.id, d)}
                          />
                        ),
                      )}
                      {lv.items.length === 0 && (
                        <span className="dim">요구 아이템 없음</span>
                      )}
                    </p>
                  </section>
                )
              })}
            </div>
          )}
        </div>
        <aside className="tracker-right">
          <JunkboxGrid title="은신처 정크박스 (전체)" items={junkItems} />
        </aside>
      </div>
    </div>
  )
}

// ---------- 탭 루트 ----------

export function TrackerTab() {
  const [mode, setMode] = useState<'quest' | 'hideout'>('quest')
  return (
    <div>
      <div className="toolbar">
        <nav className="mode-seg" aria-label="FIR 트래커 구분">
          <button
            className={mode === 'quest' ? 'active' : ''}
            onClick={() => setMode('quest')}
          >
            퀘스트 (상인별)
          </button>
          <button
            className={mode === 'hideout' ? 'active' : ''}
            onClick={() => setMode('hideout')}
          >
            은신처 (조직도)
          </button>
        </nav>
      </div>
      {mode === 'quest' ? <QuestTracker /> : <HideoutTracker />}
    </div>
  )
}
