import { useEffect, useMemo, useState } from 'react'
import { fetchGuideStatus } from '../api/guides'
import {
  biName,
  fetchQuests,
  type Quest,
  type QuestItemRef,
} from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import { ACTIVE_QUESTS_KEY, DONE_QUESTS_KEY, useIdSet } from '../lib/favorites'
import { formatNumber } from '../lib/format'
import { usePlayerLevel } from '../lib/playerLevel'
import { usePrepCounts } from '../lib/prepCounts'
import { submitObjectiveItem } from '../lib/questNeeds'
import { consumePendingQuest } from '../lib/searchSeed'
import { DoneButton } from './DoneButton'
import { TableSkeleton } from './Skeleton'
import { StarButton } from './StarButton'
import { StorylineView } from './StorylineView'

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
  const { ids: doneIds, toggle: toggleDone, set: setDone } = useIdSet(DONE_QUESTS_KEY)
  const { counts, add } = usePrepCounts()
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

  // "선행 모두 완료" — 이 퀘스트와 모든 전이적 선행을 완료로 (논리상 선행은 이미 깬 것).
  // 명시 버튼만 제공(행에서 자동 캐스케이드는 실수 위험). 해제는 개별 토글로.
  const markChainDone = () => {
    const seen = new Set<string>()
    const visit = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      setDone(id, true)
      const q = byId.get(id)
      if (q) for (const r of q.requires) visit(r)
    }
    visit(quest.id)
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
        <button
          className={`btn-ext btn-done${doneIds.has(quest.id) ? ' active' : ''}`}
          onClick={() => toggleDone(quest.id)}
          title="완료 처리하면 통합 체크리스트 등에서 이 퀘스트 아이템이 빠집니다"
        >
          {doneIds.has(quest.id) ? '✓ 완료함 · 취소' : '○ 완료로 표시'}
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
        {quest.map?.wiki && (
          <a className="btn-ext" href={quest.map.wiki} target="_blank" rel="noreferrer">
            📖 {quest.map.name} 위치 위키
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
              // 일부 생성분에 "1단계:" 번호가 박혀 있음 — <ol>이 번호를 매기므로 제거
              <li key={i}>{step.replace(/^(?:\d+\s*단계|\d+)\s*[:.)]\s*/, '')}</li>
            ))}
          </ol>
          {guide.tips && <p className="guide-tips">💡 {guide.tips}</p>}
          {(guide.images?.length ?? 0) > 0 && (
            <ul className="story-guide-shots">
              {guide.images!.map((img, i) => (
                <li key={i}>
                  {/* 라이트박스는 아이템 칩과 공유 — 캡션을 이름 자리에 넣는다 */}
                  <button
                    onClick={() =>
                      setZoomed({
                        id: img.url,
                        nameKo: img.caption || '위치 스크린샷',
                        nameEn: '',
                        iconLink: null,
                        imageLink: img.url,
                      })
                    }
                    title="클릭하면 크게"
                  >
                    <img src={img.url} alt={img.caption} loading="lazy" />
                  </button>
                  {img.caption && <span className="dim">{img.caption}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="hint" style={{ margin: '8px 0 0' }}>
            출처:{' '}
            <a className="source-link" href={guide.sourceUrl} target="_blank" rel="noreferrer">
              EFT 위키 ({guide.license}) ↗
            </a>{' '}
            {guide.images?.length ? '· 이미지: EFT 위키 ' : ''}· AI{' '}
            {(guide.version ?? 1) >= 2 ? '번역' : '요약'} — 부정확할 수 있으니 원문
            확인 권장
          </p>
        </section>
      )}
      {guideState.status === 'ready' && guideState.data === 'pending' && (
        <p className="hint">📖 공략 자동 생성 진행 중 — 매일 30개씩 채워집니다</p>
      )}

      {itemObjectives.length > 0 && (
        <section className="briefing-section">
          <h2>📦 필요 아이템</h2>
          <p className="hint" style={{ margin: '0 0 8px' }}>
            ±로 모은 개수를 기록 — “내 진행”의 통합 체크리스트와 같은 저장소라 바로
            반영됩니다 · <span className="badge-fir">FIR</span> = 레이드 획득만 인정
          </p>
          <ul className="quest-objectives">
            {itemObjectives.map((o) => {
              const it = submitObjectiveItem(o)
              const reqCount = o.count ?? 1
              const got = it ? counts[it.id] ?? 0 : 0
              return (
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
                  {it ? (
                    <span
                      className="quest-item-track"
                      title="보유 개수(통합 체크리스트와 공유) · 이 퀘스트 요구량"
                    >
                      <button
                        className="prep-step"
                        onClick={() => add(it.id, -1)}
                        disabled={got === 0}
                        aria-label="보유 빼기"
                      >
                        −
                      </button>
                      <span className="num">보유 {got}</span>
                      <button
                        className="prep-step"
                        onClick={() => add(it.id, 1)}
                        aria-label="보유 더하기"
                      >
                        +
                      </button>
                      <span className={`num quest-item-need${got >= reqCount ? ' met' : ''}`}>
                        · 요구 ×{reqCount}
                        {got >= reqCount ? ' ✓' : ''}
                      </span>
                    </span>
                  ) : (
                    o.count != null && <span className="num"> × {o.count}</span>
                  )}
                  {o.foundInRaid === true && <span className="badge-fir">FIR 필수</span>}
                  {o.foundInRaid === false && <span className="dim"> (FIR 불필요)</span>}
                </li>
              )
            })}
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
          {quest.requires.length > 0 && (
            <button
              className="btn-ext btn-done"
              onClick={markChainDone}
              title="이 퀘스트와 모든 선행을 완료로 표시"
            >
              ✓ 여기까지 선행 모두 완료
            </button>
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

// 1.0부터 메인 스토리는 트레이더 의뢰와 별개인 "스토리 챕터" 시스템 —
// tarkov.dev tasks(510개)는 전부 트레이더 의뢰라 1.0 기준 사이드퀘스트.
// 스토리라인은 위키 기반 정적 데이터(StorylineView)로 구분해 보여준다.
type QuestMode = 'side' | 'story'

export function QuestsTab() {
  const state = useAsyncData(fetchQuests)
  const [mode, setMode] = useState<QuestMode>('side')
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
  const [hideDone, setHideDone] = useState(false)
  const [availOnly, setAvailOnly] = useState(false)
  const [visible, setVisible] = useState(FIRST_PAINT_ROWS)
  const { ids: activeIds, toggle: toggleActive } = useIdSet(ACTIVE_QUESTS_KEY)
  const { ids: doneIds, toggle: toggleDone } = useIdSet(DONE_QUESTS_KEY)

  // 진행 로드맵 — 선행 퀘스트가 모두 완료됐는지(받을 수 있는지). requires는
  // dedupe 시 대표 id로 재매핑돼 done-quests(대표 id 기록)와 일관.
  // (OR/실패 조건 같은 복합 선행은 단순화돼 있어 과한 제약일 수 있음 — 안내 문구로 명시)
  const prereqsMet = (quest: Quest) => quest.requires.every((r) => doneIds.has(r))

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
        (!hideDone || !doneIds.has(quest.id)) &&
        (!availOnly || (!doneIds.has(quest.id) && prereqsMet(quest))) &&
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
  }, [quests, trader, map, maxLevel, query, sortKey, activeOnly, activeIds, hideDone, availOnly, doneIds])

  const modeSeg = (
    <div className="toolbar">
      <nav className="mode-seg" aria-label="퀘스트 구분">
        <button className={mode === 'side' ? 'active' : ''} onClick={() => setMode('side')}>
          사이드퀘스트 (트레이더 의뢰)
        </button>
        <button className={mode === 'story' ? 'active' : ''} onClick={() => setMode('story')}>
          스토리라인
        </button>
      </nav>
    </div>
  )

  // 스토리라인은 위키 기반 경량 JSON — 3MB 퀘스트 응답을 기다릴 필요 없음
  if (mode === 'story') {
    return (
      <div>
        {modeSeg}
        <StorylineView />
      </div>
    )
  }

  if (state.status === 'loading') {
    return (
      <div>
        {modeSeg}
        <TableSkeleton rows={10} label="퀘스트 데이터 불러오는 중… (최초 1회, 약 7초)" />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div>
        {modeSeg}
        <p className="status error">불러오기 실패: {state.message}</p>
      </div>
    )
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
      {modeSeg}
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
        <label className="toggle">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => { setHideDone(e.target.checked); setVisible(PAGE_SIZE) }}
          />
          ✓ 완료 숨기기
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={availOnly}
            onChange={(e) => { setAvailOnly(e.target.checked); setVisible(PAGE_SIZE) }}
          />
          ▶ 받을 수 있는 것만
        </label>
      </div>
      <p className="hint">
        {filtered.length}개 퀘스트 · 행을 클릭하면 상세 보기 · ☆ 진행 중 · ○ 완료
        체크(어디서든 공유) · <span className="quest-status avail">▶ 받을 수 있음</span>
        = 선행 모두 완료 · <span className="quest-status locked">🔒 선행 N</span> = 남은
        선행 수 · 완료를 체크할수록 로드맵이 풀립니다 · κ = 카파 필수
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
            <tr
              key={q.id}
              className={`quest-row${doneIds.has(q.id) ? ' done' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${q.displayName} 상세 보기`}
              onClick={() => setSelectedId(q.id)}
              onKeyDown={(e) => {
                // 행 자체가 포커스됐을 때만 — 안쪽 ★/○/위키에 포커스가 있으면
                // 그 버튼의 Enter/Space가 행까지 버블돼 상세가 같이 열리는 걸 막는다
                if (
                  e.target === e.currentTarget &&
                  (e.key === 'Enter' || e.key === ' ')
                ) {
                  e.preventDefault()
                  setSelectedId(q.id)
                }
              }}
            >
              <td>
                <div className="quest-name-cell">
                  <StarButton
                    on={activeIds.has(q.id)}
                    onToggle={() => toggleActive(q.id)}
                    label="진행 중"
                  />
                  <DoneButton
                    on={doneIds.has(q.id)}
                    onToggle={() => toggleDone(q.id)}
                  />
                  <span className="quest-name-text">{q.displayName}</span>
                  {!doneIds.has(q.id) &&
                    (prereqsMet(q)
                      ? q.requires.length > 0 && (
                          <span
                            className="quest-status avail"
                            title="받을 수 있음 — 선행 모두 완료"
                          >
                            ▶
                          </span>
                        )
                      : (
                          <span className="quest-status locked" title="선행 퀘스트가 남음">
                            🔒 {q.requires.filter((r) => !doneIds.has(r)).length}
                          </span>
                        ))}
                  {q.kappaRequired && <span className="badge-kappa">κ</span>}
                  {q.wikiLink && (
                    // 상세로 들어가지 않고 행에서 바로 위키 공략으로 (행 클릭과 분리)
                    <a
                      className="wiki-mini"
                      href={q.wikiLink}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="위키에서 공략 보기"
                    >
                      위키 ↗
                    </a>
                  )}
                </div>
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
