import { useEffect, useMemo, useState } from 'react'
import { CURRENCY_IDS } from '../api/hideout'
import { biName, fetchQuests, type Quest, type QuestItemRef } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import { ACTIVE_QUESTS_KEY, useIdSet } from '../lib/favorites'
import { usePlayerLevel } from '../lib/playerLevel'
import { useQuestItemMarks } from '../lib/questItemMarks'
import { TableSkeleton } from './Skeleton'
import { StarButton } from './StarButton'

const GRID_FIRST_PAINT = 60 // 타일 수백 개를 한 번에 그리지 않는 2단계 렌더

interface NeedItem {
  item: QuestItemRef
  count: number
  fir: boolean
}

interface QuestNeeds {
  quest: Quest
  items: NeedItem[]
}

interface TraderGroup {
  trader: Quest['trader']
  quests: QuestNeeds[]
  itemTotal: number
}

// 그리드 타일 1개 — 같은 아이템을 여러 퀘스트가 요구하면 합산
interface GridItem {
  item: QuestItemRef
  total: number
  fir: number
  questNames: string[]
}

// 퀘스트별 제출 아이템 — 트레이더로 묶어 "이 상인 퀘스트엔 뭐가 필요한가"를
// 인게임 임무 화면처럼 본다. 선택형(여러 아이템 중 하나)·화폐 목표는 제외
export function QuestNeedsView() {
  const state = useAsyncData(fetchQuests)
  const [level, setLevel] = usePlayerLevel()
  const [firOnly, setFirOnly] = useState(false)
  const [activeOnly, setActiveOnly] = useState(false)
  // 퀘스트별(트레이더 그룹) ↔ 아이템 그리드(정크박스처럼 한눈에)
  const [view, setView] = useState<'quests' | 'grid'>('quests')
  const [gridTrader, setGridTrader] = useState('')
  const [gridVisible, setGridVisible] = useState(GRID_FIRST_PAINT)
  const { ids: activeIds, toggle: toggleActive } = useIdSet(ACTIVE_QUESTS_KEY)
  const { marks, cycle } = useQuestItemMarks()
  // 트레이더 그룹은 펼친 것만 렌더 — 300개 퀘스트를 한 번에 그리지 않음
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())

  // 그리드 첫 페인트 후 전체로 확장 (2단계 렌더)
  useEffect(() => {
    if (view === 'grid' && gridVisible === GRID_FIRST_PAINT) {
      const t = setTimeout(() => setGridVisible(Infinity), 60)
      return () => clearTimeout(t)
    }
  }, [view, gridVisible])

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    const lvl = Number(level)
    const byTrader = new Map<string, TraderGroup>()
    for (const quest of state.data) {
      if (level && quest.minPlayerLevel > lvl) continue
      if (activeOnly && !activeIds.has(quest.id)) continue
      let items: NeedItem[] = quest.objectives
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
      if (firOnly) items = items.filter((n) => n.fir)
      if (items.length === 0) continue
      let group = byTrader.get(quest.trader.id)
      if (!group) {
        group = { trader: quest.trader, quests: [], itemTotal: 0 }
        byTrader.set(quest.trader.id, group)
      }
      group.quests.push({ quest, items })
      group.itemTotal += items.reduce((s, n) => s + n.count, 0)
    }
    const out = [...byTrader.values()]
    for (const g of out) {
      g.quests.sort((a, b) => a.quest.minPlayerLevel - b.quest.minPlayerLevel)
    }
    return out.sort((a, b) => b.quests.length - a.quests.length)
  }, [state, level, firOnly, activeOnly, activeIds])

  // 그리드용: 트레이더(또는 계정 전체)의 필요 아이템을 아이템 단위로 합산
  const gridItems = useMemo(() => {
    if (view !== 'grid') return []
    const byItem = new Map<string, GridItem>()
    for (const g of groups) {
      if (gridTrader && g.trader.id !== gridTrader) continue
      for (const { quest, items } of g.quests) {
        for (const n of items) {
          let gi = byItem.get(n.item.id)
          if (!gi) {
            gi = { item: n.item, total: 0, fir: 0, questNames: [] }
            byItem.set(n.item.id, gi)
          }
          gi.total += n.count
          if (n.fir) gi.fir += n.count
          gi.questNames.push(`${quest.nameKo} ×${n.count}${n.fir ? ' (FIR)' : ''}`)
        }
      }
    }
    return [...byItem.values()].sort((a, b) => b.total - a.total)
  }, [view, groups, gridTrader])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="퀘스트 데이터 불러오는 중… (최초 1회, 약 7초)" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  const toggleOpen = (id: string) => {
    const next = new Set(openIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpenIds(next)
  }

  const doneItems = gridItems.filter((g) => marks[g.item.id] === 'done')
  const liveItems = gridItems.filter((g) => marks[g.item.id] !== 'done')

  return (
    <div>
      <div className="toolbar">
        <nav className="mode-seg" aria-label="퀘스트 아이템 보기 방식">
          <button
            className={view === 'quests' ? 'active' : ''}
            onClick={() => setView('quests')}
          >
            퀘스트별
          </button>
          <button
            className={view === 'grid' ? 'active' : ''}
            onClick={() => {
              setView('grid')
              setGridVisible(GRID_FIRST_PAINT)
            }}
          >
            아이템 그리드
          </button>
        </nav>
        <input
          className="level-input"
          type="number"
          min="1"
          max="79"
          placeholder="내 레벨"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        />
        {view === 'grid' && (
          <select value={gridTrader} onChange={(e) => setGridTrader(e.target.value)}>
            <option value="">계정 전체 (모든 트레이더)</option>
            {groups.map((g) => (
              <option key={g.trader.id} value={g.trader.id}>
                {g.trader.name}
              </option>
            ))}
          </select>
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={firOnly}
            onChange={(e) => setFirOnly(e.target.checked)}
          />
          FIR(레이드 획득)만
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
      {view === 'grid' && (
        <>
          <p className="hint">
            필요 아이템 {liveItems.length}종을 한 화면에 — 타일 클릭으로 상태 순환:
            미확보 → <span className="qtile-legend stash">모아둠(빗금)</span> →
            완료(아래 접힘으로 사라짐) → 해제 · 같은 아이템은 퀘스트끼리 합산,
            타일에 올리면 어떤 퀘스트 몇 개인지 표시 · 상태는 이 브라우저에 저장
          </p>
          <div className="qgrid">
            {liveItems.slice(0, gridVisible).map((g) => (
              <QTile key={g.item.id} g={g} mark={marks[g.item.id]} onCycle={() => cycle(g.item.id)} />
            ))}
          </div>
          {liveItems.length === 0 && (
            <p className="hint">조건에 맞는 아이템이 없습니다.</p>
          )}
          {doneItems.length > 0 && (
            <details className="prep-done">
              <summary>✓ 완료 표시 ({doneItems.length}종) — 클릭하면 해제 가능</summary>
              <div className="qgrid">
                {doneItems.map((g) => (
                  <QTile key={g.item.id} g={g} mark={marks[g.item.id]} onCycle={() => cycle(g.item.id)} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {view === 'quests' && (
        <>
      <p className="hint">
        트레이더를 누르면 퀘스트별 제출 아이템 · <span className="badge-fir">FIR</span> =
        레이드에서 직접 획득(체크 표시)한 것만 인정 · ☆로 진행 중 표시 — 통합
        체크리스트와 연동
      </p>
      {groups.length === 0 && <p className="hint">조건에 맞는 퀘스트가 없습니다.</p>}
      {groups.map((g) => {
        const open = openIds.has(g.trader.id)
        return (
          <section key={g.trader.id} className="trader-group">
            <button
              className="trader-group-head"
              onClick={() => toggleOpen(g.trader.id)}
              aria-expanded={open}
            >
              {g.trader.imageLink && (
                <img src={g.trader.imageLink} alt="" width={44} height={44} loading="lazy" />
              )}
              <span className="trader-group-name">{g.trader.name}</span>
              <span className="dim">
                퀘스트 {g.quests.length}개 · 아이템 {g.itemTotal}개
              </span>
              <span className="prep-arrow" aria-hidden>
                {open ? '▾' : '▸'}
              </span>
            </button>
            {open && (
              <ul className="trader-quests">
                {g.quests.map(({ quest, items }) => (
                  <li key={quest.id}>
                    <p className="quest-need-head">
                      <StarButton
                        on={activeIds.has(quest.id)}
                        onToggle={() => toggleActive(quest.id)}
                        label="진행 중"
                      />
                      <span className="quest-need-name">{quest.displayName}</span>
                      {quest.minPlayerLevel > 1 && (
                        <span className="dim num">레벨 {quest.minPlayerLevel}+</span>
                      )}
                      {quest.kappaRequired && <span className="badge-kappa">κ</span>}
                    </p>
                    <p className="chip-row quest-need-items">
                      {items.map((n, i) => (
                        <span key={`${n.item.id}-${i}`} className="item-chip">
                          {n.item.iconLink && (
                            <img src={n.item.iconLink} alt="" loading="lazy" />
                          )}
                          <span>
                            {biName(n.item.nameKo, n.item.nameEn)}
                            <span className="num"> × {n.count}</span>
                          </span>
                          {n.fir && <span className="badge-fir">FIR</span>}
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
        </>
      )}
    </div>
  )
}

// 그리드 타일 — 정크박스 칸처럼 아이콘 + 필요 수량. 클릭으로 상태 순환
function QTile({
  g,
  mark,
  onCycle,
}: {
  g: GridItem
  mark?: 'stash' | 'done'
  onCycle: () => void
}) {
  const name = biName(g.item.nameKo, g.item.nameEn)
  const quests =
    g.questNames.slice(0, 6).join('\n') + (g.questNames.length > 6 ? '\n…' : '')
  return (
    <button
      className={`qtile${mark ? ` ${mark}` : ''}`}
      onClick={onCycle}
      title={`${name}\n총 ${g.total}개${g.fir > 0 ? ` (FIR ${g.fir})` : ''}\n${quests}`}
      aria-label={`${name} ${g.total}개 — ${
        mark === 'stash' ? '모아둠' : mark === 'done' ? '완료' : '미확보'
      }, 클릭하면 상태 변경`}
    >
      {g.item.iconLink && <img src={g.item.iconLink} alt="" loading="lazy" />}
      <span className="qtile-count num">×{g.total}</span>
      {g.fir > 0 && (
        <span className="qtile-fir">FIR{g.fir < g.total ? ` ${g.fir}` : ''}</span>
      )}
    </button>
  )
}
