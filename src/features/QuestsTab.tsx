import { useEffect, useMemo, useState } from 'react'
import { fetchGuideStatus } from '../api/guides'
import { biName, fetchQuests, type Quest, type QuestItemRef } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import { ACTIVE_QUESTS_KEY, useIdSet } from '../lib/favorites'
import { formatNumber } from '../lib/format'
import { usePlayerLevel } from '../lib/playerLevel'
import { consumePendingQuest } from '../lib/searchSeed'
import { TableSkeleton } from './Skeleton'
import { StarButton } from './StarButton'

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

// 아이템 칩: 아이콘 + 한/영 이름. 클릭하면 512px 이미지 라이트박스
function ItemChip({
  item,
  onZoom,
}: {
  item: QuestItemRef
  onZoom: (item: QuestItemRef) => void
}) {
  return (
    <button
      className="item-chip"
      onClick={() => item.imageLink && onZoom(item)}
      title={item.imageLink ? '클릭하면 큰 이미지' : undefined}
    >
      {item.iconLink && <img src={item.iconLink} alt="" loading="lazy" />}
      <span>{biName(item.nameKo, item.nameEn)}</span>
    </button>
  )
}

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
  const [zoomed, setZoomed] = useState<QuestItemRef | null>(null)
  const { ids: activeIds, toggle: toggleActive } = useIdSet(ACTIVE_QUESTS_KEY)
  const guideState = useAsyncData(() => fetchGuideStatus(quest.id), [quest.id])
  const guide =
    guideState.status === 'ready' && typeof guideState.data === 'object'
      ? guideState.data
      : null
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

      {/* 트레이더 초상화 + 거대 타이틀 — 상세 진입의 첫인상 */}
      <header className="quest-hero">
        {quest.trader.imageLink && (
          <img
            className="quest-hero-portrait"
            src={quest.trader.imageLink}
            alt={quest.trader.name}
            width={84}
            height={84}
          />
        )}
        <div className="quest-hero-text">
          <p className="quest-hero-meta">
            {quest.trader.name} · {quest.map?.name ?? '맵 무관'} · 요구 레벨{' '}
            {quest.minPlayerLevel}
          </p>
          <h2 className="quest-title">
            {quest.displayName}
            {quest.kappaRequired && <span className="badge-kappa">κ 카파 필수</span>}
          </h2>
        </div>
      </header>

      <div className="quest-actions">
        <button
          className={`btn-ext${activeIds.has(quest.id) ? ' active' : ''}`}
          onClick={() => toggleActive(quest.id)}
        >
          {activeIds.has(quest.id) ? '★ 진행 중' : '☆ 진행 중으로 표시'}
        </button>
        {quest.map && (
          <a
            className="btn-ext"
            href={`https://tarkov.dev/map/${quest.map.normalizedName}`}
            target="_blank"
            rel="noreferrer"
          >
            🗺️ 맵에서 위치 보기 ({quest.map.name})
          </a>
        )}
        <a
          className="btn-ext"
          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
            `${quest.nameEn} tarkov quest`,
          )}`}
          target="_blank"
          rel="noreferrer"
        >
          ▶ 영상 공략 검색
        </a>
      </div>

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

      {guide && (
        <section className="briefing-section">
          <h2>📖 공략</h2>
          <ol className="guide-steps">
            {guide.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {guide.tips && <p className="guide-tips">💡 {guide.tips}</p>}
          <p className="hint" style={{ margin: '8px 0 0' }}>
            출처:{' '}
            <a className="source-link" href={guide.sourceUrl} target="_blank" rel="noreferrer">
              EFT 위키 ({guide.license}) ↗
            </a>{' '}
            · AI 요약 — 부정확할 수 있으니 원문 확인 권장
          </p>
        </section>
      )}
      {guideState.status === 'ready' && guideState.data === 'pending' && (
        <p className="hint">📖 공략 자동 생성 진행 중 — 매일 30개씩 채워집니다</p>
      )}

      {itemObjectives.length > 0 && (
        <section className="briefing-section">
          <h2>📦 필요 아이템</h2>
          <ul className="quest-objectives">
            {itemObjectives.map((o) => (
              <li key={o.id}>
                <span className="chip-row">
                  {(o.items ?? []).slice(0, MAX_OBJECTIVE_ITEMS).map((i) => (
                    <ItemChip key={i.id} item={i} onZoom={setZoomed} />
                  ))}
                </span>
                {(o.items?.length ?? 0) > MAX_OBJECTIVE_ITEMS && (
                  <span className="dim">
                    {' '}외 {(o.items?.length ?? 0) - MAX_OBJECTIVE_ITEMS}종 중
                  </span>
                )}
                {o.count != null && <span className="num"> × {o.count}</span>}
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
              <span className="chip-row">
                <ItemChip item={i} onZoom={setZoomed} />
              </span>
              <span className="num"> × {i.count}</span>
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

      {zoomed?.imageLink && (
        <div
          className="lightbox"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-label={zoomed.nameKo}
        >
          <figure>
            <img src={zoomed.imageLink} alt={zoomed.nameKo} />
            <figcaption>
              {biName(zoomed.nameKo, zoomed.nameEn)}
              <span className="dim"> · 클릭하면 닫힘 · 이미지: tarkov.dev</span>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}

// ---------- 목록 화면 ----------

export function QuestsTab() {
  const state = useAsyncData(fetchQuests)
  // 커맨드 팔레트에서 점프해 온 경우 상세를 바로 연다 (1회용 시드)
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    consumePendingQuest(),
  )
  const [trader, setTrader] = useState('')
  const [map, setMap] = useState('')
  // "내 레벨" — 준비물 탭과 공유·localStorage 유지 (이 레벨로 받을 수 있는 퀘스트만)
  const [maxLevel, setMaxLevel] = usePlayerLevel()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('level')
  const [activeOnly, setActiveOnly] = useState(false)
  const [visible, setVisible] = useState(FIRST_PAINT_ROWS)
  const { ids: activeIds, toggle: toggleActive } = useIdSet(ACTIVE_QUESTS_KEY)

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
        (!activeOnly || activeIds.has(quest.id)) &&
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
  }, [quests, trader, map, maxLevel, query, sortKey, activeOnly, activeIds])

  if (state.status === 'loading') {
    return (
      <TableSkeleton rows={10} label="퀘스트 데이터 불러오는 중… (최초 1회, 약 7초)" />
    )
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
        <label className="toggle">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => { setActiveOnly(e.target.checked); setVisible(PAGE_SIZE) }}
          />
          ★ 진행 중만
        </label>
      </div>
      <p className="hint">
        {filtered.length}개 퀘스트 · 행을 클릭하면 상세 보기 · ☆를 누르면 진행 중
        표시 — 내 레벨 필터와 조합하면 “지금 할 일” 목록 · κ = 카파 필수
      </p>
      {activeOnly && filtered.length === 0 && (
        <p className="hint">
          진행 중으로 표시한 퀘스트가 없습니다 — 목록에서 ☆를 눌러 추가하세요.
        </p>
      )}
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
                <StarButton
                  on={activeIds.has(q.id)}
                  onToggle={() => toggleActive(q.id)}
                  label="진행 중"
                />
                {q.displayName}
                {q.kappaRequired && <span className="badge-kappa">κ</span>}
              </td>
              <td data-label="트레이더">
                <span className="trader-cell">
                  {q.trader.imageLink && (
                    <img
                      className="trader-avatar"
                      src={q.trader.imageLink}
                      alt=""
                      width={22}
                      height={22}
                      loading="lazy"
                    />
                  )}
                  {q.trader.name}
                </span>
              </td>
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
