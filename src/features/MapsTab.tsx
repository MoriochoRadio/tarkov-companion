import { fetchMapLinks, fetchMaps, type TarkovMap } from '../api/maps'
import { useAsyncData } from '../hooks/useAsyncData'

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

function MapCard({
  map,
  links,
}: {
  map: TarkovMap
  links: { label: string; url: string }[]
}) {
  return (
    <section className="map-card">
      <h2>
        {map.name} <span className="dim">{map.normalizedName}</span>
      </h2>
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
    return <p className="status">맵 데이터 불러오는 중…</p>
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
