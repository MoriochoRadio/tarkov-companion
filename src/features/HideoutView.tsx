import { useState } from 'react'
import { fetchHideoutStations, type HideoutStation } from '../api/hideout'
import { biName } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import { HIDEOUT_BUILT_KEY, useIdSet } from '../lib/favorites'
import { formatNumber } from '../lib/format'
import { usePrepCounts } from '../lib/prepCounts'
import { TableSkeleton } from './Skeleton'

export const builtKey = (stationId: string, level: number) => `${stationId}:${level}`

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

// 인게임 은신처처럼 스테이션 카드 그리드 → 선택하면 레벨별 요구 상세.
// "지었음" 체크는 통합 체크리스트 집계에서 그 레벨 몫을 제외한다 (연쇄:
// N레벨을 지으면 1~N 모두 건설됨으로, 취소하면 N 이상이 모두 취소됨)
export function HideoutView() {
  const state = useAsyncData(fetchHideoutStations)
  const { ids: built, set } = useIdSet(HIDEOUT_BUILT_KEY)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="은신처 데이터 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  const stations = state.data
  const totalLevels = stations.reduce((s, st) => s + st.levels.length, 0)
  const builtCount = stations.reduce(
    (s, st) => s + st.levels.filter((lv) => built.has(builtKey(st.id, lv.level))).length,
    0,
  )
  const selected = stations.find((s) => s.id === selectedId) ?? null

  const onBuild = (station: HideoutStation, level: number, on: boolean) => {
    // 인게임처럼 순차 건설 — 켜면 아래 레벨까지, 끄면 위 레벨까지 함께
    for (const lv of station.levels) {
      if (on && lv.level <= level) set(builtKey(station.id, lv.level), true)
      if (!on && lv.level >= level) set(builtKey(station.id, lv.level), false)
    }
  }

  return (
    <div>
      <p className="hint">
        스테이션을 누르면 레벨별 요구 아이템·선행 조건 ·{' '}
        <span className="badge-fir">FIR</span> = 레이드에서 직접 획득(체크 표시)한
        것만 인정 — 1.0부터 은신처도 일부 적용 · “지었음”으로 표시한 레벨은 통합
        체크리스트 집계에서 빠집니다 · 건설 진행:{' '}
        <span className="num">
          {builtCount}/{totalLevels}
        </span>{' '}
        레벨
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
    </div>
  )
}
