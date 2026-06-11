import { useEffect, useMemo, useState } from 'react'
import { biName, fetchQuests, type Quest } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatNumber } from '../lib/format'

const PAGE_SIZE = 60
// 데이터 도착 직후 첫 화면은 소량만 그려 단일 레이아웃 패스를 짧게 유지
// (저사양 기기에서 큰 패스 하나가 수 초 프리즈로 증폭되는 것을 실측으로 확인)
const FIRST_PAINT_ROWS = 20
// 화면에 다 나열하기 힘든 "아무 의약품이나" 류 목표는 일부만 표시
const MAX_OBJECTIVE_ITEMS = 6

type SortKey = 'level' | 'trader'

// 정렬 비교마다 로케일 비교기를 생성하지 않도록 단일 인스턴스 재사용
const collator = new Intl.Collator('ko')

// ---------- 상세 화면 ----------

function QuestDetail({
  quest,
  byId,
  onSelect,
  onBack,
}: {
  quest: Quest
  byId: Map<string, Quest>
  onSelect: (id: string) => void
  onBack: () => void
}) {
  const itemObjectives = quest.objectives.filter((o) => o.items?.length)
  const questLink = (id: string) => {
    const q = byId.get(id)
    if (!q) return null
    return (
      <button key={id} className="quest-link" onClick={() => onSelect(id)}>
        {q.displayName}
      </button>
    )
  }

  return (
    <div>
      <div className="toolbar">
        <button className="quest-back" onClick={onBack}>
          ← 목록으로
        </button>
        {quest.wikiLink && (
          <a className="source-link" href={quest.wikiLink} target="_blank" rel="noreferrer">
            위키 원문 ↗
          </a>
        )}
      </div>

      <h2 className="quest-title">
        {quest.displayName}
        {quest.kappaRequired && <span className="badge-kappa">κ 카파 필수</span>}
      </h2>
      <p className="hint">
        {quest.trader.name} · {quest.map?.name ?? '맵 무관'} · 요구 레벨{' '}
        {quest.minPlayerLevel}
      </p>

      <section className="briefing-section">
        <h2>🎯 목표</h2>
        <ul className="quest-objectives">
          {quest.objectives.map((o) => (
            <li key={o.id}>
              <span className="dim">☐</span> {o.description || o.type}
              {o.optional && <span className="dim"> (선택)</span>}
            </li>
          ))}
        </ul>
      </section>

      {itemObjectives.length > 0 && (
        <section className="briefing-section">
          <h2>📦 필요 아이템</h2>
          <ul className="quest-objectives">
            {itemObjectives.map((o) => (
              <li key={o.id}>
                {(o.items ?? []).slice(0, MAX_OBJECTIVE_ITEMS).map((i) => biName(i.nameKo, i.nameEn)).join(', ')}
                {(o.items?.length ?? 0) > MAX_OBJECTIVE_ITEMS &&
                  ` 외 ${(o.items?.length ?? 0) - MAX_OBJECTIVE_ITEMS}종 중`}
                {o.count != null && ` × ${o.count}`}
                {o.foundInRaid === true && <span className="badge-fir">FIR 필수</span>}
                {o.foundInRaid === false && <span className="dim"> (FIR 불필요)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="briefing-section">
        <h2>🎁 보상</h2>
        <ul className="quest-objectives">
          {quest.experience > 0 && <li>경험치 +{formatNumber(quest.experience)}</li>}
          {quest.rewards.standing.map((s) => (
            <li key={s.trader}>
              {s.trader} 평판 {s.standing > 0 ? '+' : ''}
              {s.standing}
            </li>
          ))}
          {quest.rewards.items.map((i) => (
            <li key={i.id}>
              {biName(i.nameKo, i.nameEn)} × {i.count}
            </li>
          ))}
          {quest.experience === 0 &&
            quest.rewards.standing.length === 0 &&
            quest.rewards.items.length === 0 && <li className="dim">보상 정보 없음</li>}
        </ul>
      </section>

      {(quest.requires.length > 0 || quest.unlocks.length > 0) && (
        <section className="briefing-section">
          <h2>🔗 퀘스트 체인</h2>
          {quest.requires.length > 0 && (
            <p>
              <span className="dim">선행:</span> {quest.requires.map(questLink)}
            </p>
          )}
          {quest.unlocks.length > 0 && (
            <p>
              <span className="dim">후행:</span> {quest.unlocks.map(questLink)}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

// ---------- 목록 화면 ----------

export function QuestsTab() {
  const state = useAsyncData(fetchQuests)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trader, setTrader] = useState('')
  const [map, setMap] = useState('')
  const [maxLevel, setMaxLevel] = useState('') // "내 레벨" — 이 레벨로 받을 수 있는 퀘스트만
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('level')
  const [visible, setVisible] = useState(FIRST_PAINT_ROWS)

  // 첫 페인트가 끝나면 한 페이지 분량으로 확장 (2단계 렌더)
  useEffect(() => {
    if (state.status === 'ready' && visible < PAGE_SIZE) {
      const t = setTimeout(() => setVisible(PAGE_SIZE), 50)
      return () => clearTimeout(t)
    }
    // visible은 의도적으로 제외 — 확장은 데이터 도착 후 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  const quests = state.status === 'ready' ? state.data : []
  const byId = useMemo(() => new Map(quests.map((q) => [q.id, q])), [quests])

  const traders = useMemo(
    () => [...new Map(quests.map((q) => [q.trader.id, q.trader])).values()],
    [quests],
  )
  const maps = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const q of quests) {
      if (q.map) m.set(q.map.id, q.map)
    }
    return [...m.values()]
  }, [quests])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const level = Number(maxLevel)
    const result = quests.filter(
      (quest) =>
        (!trader || quest.trader.id === trader) &&
        (!map || quest.map?.id === map) &&
        (!maxLevel || quest.minPlayerLevel <= level) &&
        (!q || quest.searchKey.includes(q)),
    )
    return result.sort((a, b) =>
      sortKey === 'level'
        ? a.minPlayerLevel - b.minPlayerLevel ||
          collator.compare(a.trader.name, b.trader.name)
        : collator.compare(a.trader.name, b.trader.name) ||
          a.minPlayerLevel - b.minPlayerLevel,
    )
  }, [quests, trader, map, maxLevel, query, sortKey])

  if (state.status === 'loading') {
    return <p className="status">퀘스트 데이터 불러오는 중… (최초 1회, 약 7초)</p>
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  const selected = selectedId ? byId.get(selectedId) : null
  if (selected) {
    return (
      <QuestDetail
        quest={selected}
        byId={byId}
        onSelect={setSelectedId}
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
          placeholder="퀘스트 이름 검색 (한국어/영어)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setVisible(PAGE_SIZE)
          }}
        />
        <select value={trader} onChange={(e) => { setTrader(e.target.value); setVisible(PAGE_SIZE) }}>
          <option value="">전체 트레이더</option>
          {traders.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select value={map} onChange={(e) => { setMap(e.target.value); setVisible(PAGE_SIZE) }}>
          <option value="">전체 맵</option>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <input
          className="level-input"
          type="number"
          min="1"
          max="79"
          placeholder="내 레벨"
          value={maxLevel}
          onChange={(e) => { setMaxLevel(e.target.value); setVisible(PAGE_SIZE) }}
        />
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="level">레벨순</option>
          <option value="trader">트레이더순</option>
        </select>
      </div>
      <p className="hint">
        {filtered.length}개 퀘스트 · 행을 클릭하면 상세 보기 · κ = 카파 컨테이너 필수
        퀘스트
      </p>
      <table className="data-table quest-table card-table">
        <thead>
          <tr>
            <th>퀘스트</th>
            <th>트레이더</th>
            <th>맵</th>
            <th className="num">레벨</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((q) => (
            <tr key={q.id} className="quest-row" onClick={() => setSelectedId(q.id)}>
              <td>
                {q.displayName}
                {q.kappaRequired && <span className="badge-kappa">κ</span>}
              </td>
              <td data-label="트레이더">{q.trader.name}</td>
              <td className="dim" data-label="맵">{q.map?.name ?? '무관'}</td>
              <td className="num" data-label="레벨">{q.minPlayerLevel}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > visible && (
        <button className="load-more" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
          더 보기 ({filtered.length - visible}개 남음)
        </button>
      )}
    </div>
  )
}
