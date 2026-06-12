import { useEffect, useMemo, useState } from 'react'
import { biName, fetchQuests, type Quest, type QuestItemRef } from '../api/quests'
import { fetchAllItems, type TarkovItem } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { TableSkeleton } from './Skeleton'

// 해금 탭 — "이 아이템 언제 살 수 있어?"의 역방향 답.
// tasks의 finishRewards.offerUnlock(실측 228개 오퍼)을 아이템 기준으로 뒤집어
// "아이템 → 해금 퀘스트(트레이더 LL) → 선행 퀘스트 체인"을 한 화면에 보여준다.
// 데이터는 퀘스트 탭과 같은 3MB 세션 캐시 공유 — 추가 요청 없음.

const FIRST_PAINT_TILES = 24

interface UnlockSource {
  quest: Quest
  trader: { id: string; name: string }
  level: number // 트레이더 로열티 레벨
}

interface UnlockItem {
  item: QuestItemRef
  searchKey: string
  sources: UnlockSource[]
}

const collator = new Intl.Collator('ko')

// 선행 퀘스트 체인 — requires를 따라 올라간 조상 전체를 DFS 후위 순회로 수집.
// 후위 순회는 "선행을 모두 밀어 넣은 뒤 자신"이므로 그대로 위상 정렬이 된다
// (정확성은 scripts/check-unlocks.mjs가 전 228개 오퍼에 대해 자동 검증).
function buildChain(quest: Quest, byId: Map<string, Quest>): Quest[] {
  const seen = new Set<string>()
  const order: Quest[] = []
  const visit = (q: Quest) => {
    if (seen.has(q.id)) return
    seen.add(q.id)
    for (const rid of q.requires) {
      const r = byId.get(rid)
      if (r) visit(r)
    }
    order.push(q)
  }
  visit(quest)
  return order
}

function ChainList({
  unlocking,
  byId,
  onQuest,
}: {
  unlocking: Quest
  byId: Map<string, Quest>
  onQuest?: (id: string) => void
}) {
  const chain = buildChain(unlocking, byId)
  const maxLevel = Math.max(...chain.map((q) => q.minPlayerLevel))
  return (
    <div className="unlock-chain">
      <p className="hint">
        선행 포함 총 {chain.length}개 퀘스트 · 체인 최고 요구 레벨{' '}
        <span className="num">{maxLevel}</span> · 퀘스트를 누르면 상세로 이동
      </p>
      <ol className="unlock-chain-list">
        {chain.map((q, i) => (
          <li
            key={q.id}
            className={q.id === unlocking.id ? 'unlock-chain-final' : ''}
          >
            <span className="unlock-chain-num num">{i + 1}</span>
            <button className="quest-link" onClick={() => onQuest?.(q.id)}>
              {q.displayName}
            </button>
            <span className="dim">
              {q.trader.name} · Lv {q.minPlayerLevel}
              {q.id === unlocking.id && ' · 완료 시 해금'}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function UnlockDetail({
  entry,
  byId,
  onQuest,
  onBack,
}: {
  entry: UnlockItem
  byId: Map<string, Quest>
  onQuest?: (id: string) => void
  onBack: () => void
}) {
  return (
    <div>
      <div className="toolbar">
        <button className="quest-back" onClick={onBack}>
          ← 목록으로
        </button>
      </div>
      <header className="unlock-hero">
        {entry.item.iconLink && (
          <img src={entry.item.iconLink} alt="" width={64} height={64} />
        )}
        <div>
          <p className="quest-hero-meta">트레이더 오퍼 해금 아이템</p>
          <h2 className="quest-title">
            {biName(entry.item.nameKo, entry.item.nameEn)}
          </h2>
        </div>
      </header>
      {entry.sources.map((s) => (
        <section className="briefing-section" key={`${s.quest.id}-${s.trader.id}`}>
          <h2>
            🔓 {s.trader.name} LL{s.level}에서 구매 해금 —{' '}
            {s.quest.displayName}
          </h2>
          <p className="hint">
            퀘스트 요구 레벨 {s.quest.minPlayerLevel} · {s.quest.trader.name}
            {s.quest.kappaRequired && <span className="badge-kappa">κ</span>}
          </p>
          <ChainList unlocking={s.quest} byId={byId} onQuest={onQuest} />
        </section>
      ))}
    </div>
  )
}

export function UnlocksTab({ onQuest }: { onQuest?: (id: string) => void }) {
  const state = useAsyncData(fetchQuests)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visible, setVisible] = useState(FIRST_PAINT_TILES)
  // 해금 아이템이 아닌 검색어 판별용 — 검색 결과가 비었을 때만 lazy 로드
  const [allItems, setAllItems] = useState<TarkovItem[] | null>(null)

  const quests = state.status === 'ready' ? state.data : []
  const byId = useMemo(() => new Map(quests.map((q) => [q.id, q])), [quests])

  // 역인덱스: 아이템 → 해금 오퍼들. 같은 아이템이 여러 퀘스트에서 풀리면 sources 복수
  const unlockItems = useMemo(() => {
    const map = new Map<string, UnlockItem>()
    for (const q of quests) {
      for (const o of q.unlockOffers) {
        let entry = map.get(o.item.id)
        if (!entry) {
          entry = {
            item: o.item,
            searchKey: `${o.item.nameKo} ${o.item.nameEn}`.toLowerCase(),
            sources: [],
          }
          map.set(o.item.id, entry)
        }
        entry.sources.push({ quest: q, trader: o.trader, level: o.level })
      }
    }
    const list = [...map.values()]
    for (const e of list) e.sources.sort((a, b) => a.level - b.level)
    return list.sort((a, b) => collator.compare(a.item.nameKo, b.item.nameKo))
  }, [quests])

  // 첫 페인트는 타일 소량만 — 아이콘 다수 목록의 단일 레이아웃 패스 분할 (CLAUDE.md)
  useEffect(() => {
    if (state.status === 'ready' && visible <= FIRST_PAINT_TILES) {
      const t = setTimeout(() => setVisible(Infinity), 50)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? unlockItems.filter((e) => e.searchKey.includes(q)) : unlockItems),
    [unlockItems, q],
  )

  // 해금 목록에 없는 검색어 → 전체 아이템과 대조해 "해금 불필요" 안내
  const wantFallback = q.length >= 2 && filtered.length === 0
  useEffect(() => {
    if (!wantFallback || allItems) return
    let on = true
    fetchAllItems()
      .then((d) => on && setAllItems(d))
      .catch(() => {}) // 안내가 안 뜰 뿐 검색 자체는 동작
    return () => {
      on = false
    }
  }, [wantFallback, allItems])
  const fallbackMatches = useMemo(() => {
    if (!wantFallback || !allItems) return []
    return allItems
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.shortName.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [wantFallback, allItems, q])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="퀘스트 데이터 불러오는 중… (최초 1회, 약 7초)" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  const selected = selectedId
    ? unlockItems.find((e) => e.item.id === selectedId)
    : null
  if (selected) {
    return (
      <UnlockDetail
        entry={selected}
        byId={byId}
        onQuest={onQuest}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  const shown = filtered.slice(0, visible)

  return (
    <div>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="아이템 이름 검색 (한국어/영어) — 예: M995, 도트사이트"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="hint">
        퀘스트를 깨야 트레이더 상점에 풀리는 아이템 {unlockItems.length}종 —
        아이템을 누르면 해금 퀘스트와 선행 체인이 순서대로 나옵니다
      </p>
      {filtered.length > 0 && (
        <ul className="unlock-grid">
          {shown.map((e) => (
            <li key={e.item.id}>
              <button
                className="unlock-card"
                onClick={() => setSelectedId(e.item.id)}
              >
                {e.item.iconLink && (
                  <img src={e.item.iconLink} alt="" loading="lazy" width={40} height={40} />
                )}
                <span className="unlock-card-name">
                  {biName(e.item.nameKo, e.item.nameEn)}
                </span>
                <span className="unlock-card-meta dim">
                  {/* 동명 변형 퀘스트(진영/루트 분기)가 같은 트레이더·LL로 풀면 한 번만 표기 */}
                  {[...new Set(e.sources.map((s) => `${s.trader.name} LL${s.level}`))].join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {wantFallback && (
        <div className="unlock-fallback">
          {fallbackMatches.length > 0 ? (
            <>
              <p className="hint">
                ✅ 검색된 아이템은 퀘스트로 해금되는 오퍼가 없습니다 — 트레이더
                기본 오퍼 또는 플리마켓에서 바로 구매 가능한 경우가 대부분입니다
                (일부는 바터/제작 전용일 수 있음):
              </p>
              <ul className="unlock-grid">
                {fallbackMatches.map((i) => (
                  <li key={i.id}>
                    <span className="unlock-card unlock-card-static">
                      {i.iconLink && (
                        <img src={i.iconLink} alt="" loading="lazy" width={40} height={40} />
                      )}
                      <span className="unlock-card-name">{i.name}</span>
                      <span className="unlock-card-meta dim">해금 불필요</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : allItems ? (
            <p className="hint">검색 결과 없음 — 다른 이름으로 검색해 보세요</p>
          ) : (
            <p className="hint">전체 아이템과 대조하는 중…</p>
          )}
        </div>
      )}
    </div>
  )
}
