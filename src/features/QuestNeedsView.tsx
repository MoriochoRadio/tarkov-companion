import { useMemo, useState } from 'react'
import { CURRENCY_IDS } from '../api/hideout'
import { biName, fetchQuests, type Quest, type QuestItemRef } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import { ACTIVE_QUESTS_KEY, useIdSet } from '../lib/favorites'
import { usePlayerLevel } from '../lib/playerLevel'
import { TableSkeleton } from './Skeleton'
import { StarButton } from './StarButton'

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

// 퀘스트별 제출 아이템 — 트레이더로 묶어 "이 상인 퀘스트엔 뭐가 필요한가"를
// 인게임 임무 화면처럼 본다. 선택형(여러 아이템 중 하나)·화폐 목표는 제외
export function QuestNeedsView() {
  const state = useAsyncData(fetchQuests)
  const [level, setLevel] = usePlayerLevel()
  const [firOnly, setFirOnly] = useState(false)
  const [activeOnly, setActiveOnly] = useState(false)
  const { ids: activeIds, toggle: toggleActive } = useIdSet(ACTIVE_QUESTS_KEY)
  // 트레이더 그룹은 펼친 것만 렌더 — 300개 퀘스트를 한 번에 그리지 않음
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())

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
    </div>
  )
}
