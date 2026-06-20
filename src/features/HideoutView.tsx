import { useEffect, useMemo, useState } from 'react'
import { fetchHideoutStations, type HideoutStation } from '../api/hideout'
import { biName } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import { HIDEOUT_BUILT_KEY, useIdSet } from '../lib/favorites'
import { formatNumber } from '../lib/format'
import { computeBuildOrder } from '../lib/hideoutOrder'
import { usePrepCounts } from '../lib/prepCounts'
import { ErrorState, TableSkeleton } from './Skeleton'

export const builtKey = (stationId: string, level: number) => `${stationId}:${level}`

// 인게임처럼 순차 건설 — 켜면 아래 레벨까지, 끄면 위 레벨까지 함께.
// FIR 트래커(TrackerTab)와 공유 — 같은 tc:hideout-built 키를 같은 규칙으로 갱신
export function cascadeBuilt(
  set: (id: string, on: boolean) => void,
  station: HideoutStation,
  level: number,
  on: boolean,
) {
  for (const lv of station.levels) {
    if (on && lv.level <= level) set(builtKey(station.id, lv.level), true)
    if (!on && lv.level >= level) set(builtKey(station.id, lv.level), false)
  }
}

// 건설 순서 뷰 첫 페인트 행 수 — 행마다 아이템 아이콘이 많아 2단계 렌더 필수
// (Phase 17 교훈: 아이콘 많은 목록은 무조건 2단계 렌더로 시작)
const ORDER_FIRST_ROWS = 12

function formatTime(sec: number): string {
  if (sec <= 0) return '즉시'
  const h = sec / 3600
  if (h >= 1) return `${Math.round(h)}시간`
  return `${Math.round(sec / 60)}분`
}

function LevelBlock({
  station,
  level,
  built,
  onBuild,
}: {
  station: HideoutStation
  level: HideoutStation['levels'][number]
  built: ReadonlySet<string>
  onBuild: (level: number, on: boolean) => void
}) {
  const { counts } = usePrepCounts()
  const isBuilt = built.has(builtKey(station.id, level.level))
  return (
    <section className={`hideout-level${isBuilt ? ' built' : ''}`}>
      <header className="hideout-level-head">
        <h4>
          {level.level}레벨
          {isBuilt && <span className="hideout-built-badge">✓ 건설됨</span>}
        </h4>
        <span className="dim num">건설 {formatTime(level.constructionTime)}</span>
        <button
          className={`btn-ext${isBuilt ? ' active' : ''}`}
          onClick={() => onBuild(level.level, !isBuilt)}
        >
          {isBuilt ? '건설 취소' : '지었음으로 표시'}
        </button>
      </header>
      {(level.stationRequirements.length > 0 ||
        level.traderRequirements.length > 0 ||
        level.skillRequirements.length > 0) && (
        <p className="hideout-prereqs">
          {level.stationRequirements.map((r) => (
            <span key={r.stationId} className="prep-chip">
              {r.name} {r.level}레벨
            </span>
          ))}
          {level.traderRequirements.map((r) => (
            <span key={r.name} className="prep-chip">
              {r.name} LL{r.level}
            </span>
          ))}
          {level.skillRequirements.map((r) => (
            <span key={r.name} className="prep-chip">
              스킬 {r.name} {r.level}
            </span>
          ))}
        </p>
      )}
      <ul className="hideout-items">
        {level.items.map((r, i) => (
          <li key={`${r.item.id}-${i}`}>
            {r.item.iconLink && <img src={r.item.iconLink} alt="" loading="lazy" />}
            <span className="hideout-item-name">
              {r.isCurrency ? r.item.nameKo : biName(r.item.nameKo, r.item.nameEn)}
            </span>
            <span className="num">
              {r.isCurrency ? `₽ ${formatNumber(r.count)}` : `× ${r.count}`}
            </span>
            {r.fir && <span className="badge-fir">FIR</span>}
            {!r.isCurrency && (counts[r.item.id] ?? 0) > 0 && (
              <span className="num hideout-have">보유 {counts[r.item.id]}</span>
            )}
          </li>
        ))}
        {level.items.length === 0 && <li className="dim">요구 아이템 없음</li>}
      </ul>
    </section>
  )
}

// --- 건설 순서 뷰: 선행 조건 위상 정렬 — "이 순서대로 지으면 안 막힘" ---
// FIR 요구 아이템도 이 순서대로 나오므로 "다음에 모아야 할 FIR"이 바로 보인다
function BuildOrderView({
  stations,
  built,
  onBuild,
}: {
  stations: HideoutStation[]
  built: ReadonlySet<string>
  onBuild: (station: HideoutStation, level: number, on: boolean) => void
}) {
  const { counts } = usePrepCounts()
  const [firOnly, setFirOnly] = useState(false)
  const [hideBuilt, setHideBuilt] = useState(false)
  const [visible, setVisible] = useState(ORDER_FIRST_ROWS)

  // 첫 페인트가 끝나면 전체로 확장 (2단계 렌더)
  useEffect(() => {
    const t = setTimeout(() => setVisible(Infinity), 50)
    return () => clearTimeout(t)
  }, [])

  const steps = useMemo(
    () => computeBuildOrder(stations).map((s, i) => ({ ...s, order: i + 1 })),
    [stations],
  )

  const isBuilt = (stationId: string, level: number) =>
    built.has(builtKey(stationId, level))
  // "지금 건설 가능" = 아직 안 지었고 선행(아래 레벨 + 요구 스테이션)을 다 지음
  const isReady = (s: (typeof steps)[number]) =>
    !isBuilt(s.station.id, s.level.level) &&
    (s.level.level === 1 || isBuilt(s.station.id, s.level.level - 1)) &&
    s.level.stationRequirements.every((r) => isBuilt(r.stationId, r.level))

  const filtered = steps.filter(
    (s) =>
      (!firOnly || s.level.items.some((r) => r.fir)) &&
      (!hideBuilt || !isBuilt(s.station.id, s.level.level)),
  )
  const shown = filtered.slice(0, visible)
  const firTotal = steps.filter(
    (s) => !isBuilt(s.station.id, s.level.level) && s.level.items.some((r) => r.fir),
  ).length

  return (
    <div>
      <div className="toolbar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={firOnly}
            onChange={(e) => setFirOnly(e.target.checked)}
          />
          <span className="badge-fir">FIR</span> 필요 레벨만
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={hideBuilt}
            onChange={(e) => setHideBuilt(e.target.checked)}
          />
          건설한 레벨 숨기기
        </label>
      </div>
      <p className="hint">
        선행 조건(아래 레벨·요구 스테이션)이 먼저 오도록 정렬한 추천 건설 순서 —
        같은 시점이면 트레이더 LL이 낮게 풀리는 것부터 ·{' '}
        <span className="badge-ready">건설 가능</span> = 선행을 모두 지어 바로
        착공 가능 · 남은 FIR 요구 레벨 <span className="num">{firTotal}</span>개
      </p>
      <ol className="bo-list">
        {shown.map((s) => {
          const b = isBuilt(s.station.id, s.level.level)
          const ready = isReady(s)
          return (
            <li
              key={`${s.station.id}:${s.level.level}`}
              className={`bo-step${b ? ' built' : ''}${ready ? ' ready' : ''}`}
            >
              <span className="bo-num num">{s.order}</span>
              <div className="bo-main">
                <header className="bo-head">
                  {s.station.imageLink && (
                    <img className="bo-station-icon" src={s.station.imageLink} alt="" loading="lazy" />
                  )}
                  <strong className="bo-station-name">{s.station.name}</strong>
                  <span className="bo-lv num">{s.level.level}레벨</span>
                  {s.gateLL > 1 && (
                    <span className="prep-chip" title="이 레벨까지 가는 데 필요한 트레이더 로열티 (선행 포함)">
                      LL{s.gateLL} 시점
                    </span>
                  )}
                  {s.level.skillRequirements.map((r) => (
                    <span key={r.name} className="prep-chip">
                      스킬 {r.name} {r.level}
                    </span>
                  ))}
                  {ready && <span className="badge-ready">건설 가능</span>}
                  {b && <span className="hideout-built-badge">✓ 건설됨</span>}
                  <button
                    className={`btn-ext bo-toggle${b ? ' active' : ''}`}
                    onClick={() => onBuild(s.station, s.level.level, !b)}
                  >
                    {b ? '취소' : '지었음'}
                  </button>
                </header>
                {s.level.items.length > 0 && (
                  <ul className="bo-items">
                    {s.level.items.map((r, i) => (
                      <li key={`${r.item.id}-${i}`} title={biName(r.item.nameKo, r.item.nameEn)}>
                        {r.item.iconLink && (
                          <img src={r.item.iconLink} alt="" loading="lazy" />
                        )}
                        <span className="bo-item-name">{r.item.nameKo}</span>
                        <span className="num">
                          {r.isCurrency ? `₽ ${formatNumber(r.count)}` : `× ${r.count}`}
                        </span>
                        {r.fir && <span className="badge-fir">FIR</span>}
                        {!r.isCurrency && (counts[r.item.id] ?? 0) > 0 && (
                          <span className="num hideout-have">보유 {counts[r.item.id]}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {filtered.length > shown.length && (
        <p className="hint">나머지 {filtered.length - shown.length}개 표시 중…</p>
      )}
    </div>
  )
}

type HideoutMode = 'stations' | 'order'

// 인게임 은신처처럼 스테이션 카드 그리드 → 선택하면 레벨별 요구 상세.
// "지었음" 체크는 통합 체크리스트 집계에서 그 레벨 몫을 제외한다 (연쇄:
// N레벨을 지으면 1~N 모두 건설됨으로, 취소하면 N 이상이 모두 취소됨)
export function HideoutView() {
  const state = useAsyncData(fetchHideoutStations)
  const { ids: built, set } = useIdSet(HIDEOUT_BUILT_KEY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<HideoutMode>('stations')

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="은신처 데이터 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <ErrorState message={state.message} onRetry={state.reload} />
  }

  const stations = state.data
  const totalLevels = stations.reduce((s, st) => s + st.levels.length, 0)
  const builtCount = stations.reduce(
    (s, st) => s + st.levels.filter((lv) => built.has(builtKey(st.id, lv.level))).length,
    0,
  )
  const selected = stations.find((s) => s.id === selectedId) ?? null

  const onBuild = (station: HideoutStation, level: number, on: boolean) =>
    cascadeBuilt(set, station, level, on)

  return (
    <div>
      <div className="toolbar">
        <nav className="mode-seg" aria-label="은신처 보기 방식">
          <button
            className={mode === 'stations' ? 'active' : ''}
            onClick={() => setMode('stations')}
          >
            스테이션
          </button>
          <button
            className={mode === 'order' ? 'active' : ''}
            onClick={() => setMode('order')}
          >
            건설 순서
          </button>
        </nav>
        <span className="hint" style={{ margin: 0 }}>
          건설 진행:{' '}
          <span className="num">
            {builtCount}/{totalLevels}
          </span>{' '}
          레벨
        </span>
      </div>
      {mode === 'order' ? (
        <BuildOrderView stations={stations} built={built} onBuild={onBuild} />
      ) : (
        <>
          <p className="hint">
            스테이션을 누르면 레벨별 요구 아이템·선행 조건 ·{' '}
            <span className="badge-fir">FIR</span> = 레이드에서 직접 획득(체크
            표시)한 것만 인정 — 1.0부터 은신처도 일부 적용 · “지었음”으로 표시한
            레벨은 통합 체크리스트 집계에서 빠집니다
          </p>
          <ul className="station-grid">
            {stations.map((s) => {
              const done = s.levels.filter((lv) => built.has(builtKey(s.id, lv.level))).length
              return (
                <li key={s.id}>
                  <button
                    className={`station-card${s.id === selectedId ? ' active' : ''}${
                      done === s.levels.length ? ' done' : ''
                    }`}
                    onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                  >
                    {/* 작은 PNG 26개 — lazy로 미루면 그리드가 빈 카드로 깜빡여서 즉시 로드 */}
                    {s.imageLink && <img src={s.imageLink} alt="" />}
                    <span className="station-name">{s.name}</span>
                    <span className="station-progress num">
                      {done}/{s.levels.length}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected && (
            <div className="station-detail">
              <h3 className="station-detail-title">
                {selected.imageLink && <img src={selected.imageLink} alt="" />}
                {selected.name}
              </h3>
              {selected.levels.map((lv) => (
                <LevelBlock
                  key={lv.level}
                  station={selected}
                  level={lv}
                  built={built}
                  onBuild={(level, on) => onBuild(selected, level, on)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
