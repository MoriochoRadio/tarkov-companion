import { fetchMapLinks, fetchMaps, type MapExtract, type TarkovMap } from '../api/maps'
import { useAsyncData } from '../hooks/useAsyncData'
import { useTilt } from '../hooks/useTilt'
import { TableSkeleton } from './Skeleton'

const FACTION_LABELS: Record<MapExtract['faction'], string> = {
  pmc: 'PMC 전용',
  shared: '공용',
  scav: '스캐브 전용',
}

// 탈출구 목록 — 진영별로 묶어 접이식으로 (카드 기본 높이를 지키기 위해)
function ExtractList({ extracts }: { extracts: MapExtract[] }) {
  if (extracts.length === 0) return null
  const groups = (['pmc', 'shared', 'scav'] as const)
    .map((f) => ({ f, list: extracts.filter((e) => e.faction === f) }))
    .filter((g) => g.list.length > 0)
  const pmcCount = extracts.filter((e) => e.faction !== 'scav').length
  return (
    <details className="map-extracts">
      <summary>
        🚪 탈출구 {extracts.length}개{' '}
        <span className="dim">(PMC 이용 가능 {pmcCount})</span>
      </summary>
      {groups.map((g) => (
        <p key={g.f} className="map-extract-group">
          <span className={`extract-tag extract-${g.f}`}>{FACTION_LABELS[g.f]}</span>
          {g.list.map((e) => e.name).join(' · ')}
        </p>
      ))}
    </details>
  )
}

function bossLabel(map: TarkovMap): string {
  if (map.bosses.length === 0) return '보스 없음'
  // 같은 보스가 스폰 지점별로 중복 — 이름 기준으로 합치고 최고 확률 표시
  const byName = new Map<string, number>()
  for (const b of map.bosses) {
    byName.set(b.name, Math.max(byName.get(b.name) ?? 0, b.spawnChance))
  }
  return [...byName.entries()]
    .map(([name, chance]) => `${name} ${Math.round(chance * 100)}%`)
    .join(' · ')
}

// 배너에 올릴 보스 초상화 — 이름 기준 중복 제거, 최대 3명
function bossPortraits(map: TarkovMap): { name: string; src: string }[] {
  const seen = new Set<string>()
  const out: { name: string; src: string }[] = []
  for (const b of map.bosses) {
    if (!b.portrait || seen.has(b.name)) continue
    seen.add(b.name)
    out.push({ name: b.name, src: b.portrait })
    if (out.length >= 3) break
  }
  return out
}

function MapCard({
  map,
  links,
}: {
  map: TarkovMap
  links: { label: string; url: string }[]
}) {
  const tilt = useTilt<HTMLElement>()
  const portraits = bossPortraits(map)
  return (
    <section
      className="map-card"
      ref={tilt.ref}
      onMouseMove={tilt.onMove}
      onMouseLeave={tilt.onLeave}
    >
      {/* 보스 초상화 배너 + 초대형 맵 이름 — 이미지 출처는 아이템 아이콘과 동일(tarkov.dev) */}
      <div className="map-banner">
        {portraits.length > 0 && (
          <div className="map-banner-bosses" aria-hidden>
            {portraits.map((p) => (
              <img key={p.name} src={p.src} alt="" loading="lazy" title={p.name} />
            ))}
          </div>
        )}
        <span className="map-code">{map.normalizedName}</span>
        <h2 className="map-name">{map.name}</h2>
      </div>
      <dl className="map-facts">
        <div>
          <dt>레이드</dt>
          <dd className="num">{map.raidDuration ? `${map.raidDuration}분` : '—'}</dd>
        </div>
        <div>
          <dt>인원</dt>
          <dd className="num">{map.players ?? '—'}</dd>
        </div>
        <div>
          <dt>보스</dt>
          <dd>{bossLabel(map)}</dd>
        </div>
        {map.accessKeys.length > 0 && (
          <div>
            <dt>요구</dt>
            <dd>
              {map.accessKeys.join(', ')}
              {(map.accessKeysMinPlayerLevel ?? 0) > 0 &&
                ` (레벨 ${map.accessKeysMinPlayerLevel}+)`}
            </dd>
          </div>
        )}
      </dl>
      <ExtractList extracts={map.extracts} />
      <div className="quest-actions">
        <a
          className="btn-ext"
          href={`https://tarkov.dev/map/${map.normalizedName}`}
          target="_blank"
          rel="noreferrer"
        >
          인터랙티브 맵
        </a>
        {map.wiki && (
          <a className="btn-ext" href={map.wiki} target="_blank" rel="noreferrer">
            공식 위키
          </a>
        )}
        {links.map((l) => (
          <a key={l.url} className="btn-ext" href={l.url} target="_blank" rel="noreferrer">
            {l.label}
          </a>
        ))}
      </div>
    </section>
  )
}

export function MapsTab() {
  const mapsState = useAsyncData(fetchMaps)
  const linksState = useAsyncData(fetchMapLinks)

  if (mapsState.status === 'loading') {
    return <TableSkeleton rows={6} label="맵 데이터 불러오는 중…" />
  }
  if (mapsState.status === 'error') {
    return <p className="status error">불러오기 실패: {mapsState.message}</p>
  }

  const links = linksState.status === 'ready' ? linksState.data : {}

  return (
    <div>
      <p className="hint">
        모든 외부 지도는 링크로만 연결 (이미지 미수록) · 한글 지도 링크는{' '}
        <code>public/data/map-links.json</code>에서 관리
      </p>
      <div className="maps-grid">
        {mapsState.data.map((m) => (
          <MapCard key={m.id} map={m} links={links[m.normalizedName] ?? []} />
        ))}
      </div>
    </div>
  )
}
