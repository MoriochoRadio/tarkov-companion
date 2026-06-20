import { useMemo, useState } from 'react'
import { fetchAmmo, type AmmoInfo } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatRub } from '../lib/format'
import { ItemCell } from './ItemRow'
import { ErrorState, TableSkeleton } from './Skeleton'

// API의 구경 코드("Caliber556x45NATO")를 사람이 읽는 이름으로
const CALIBER_NAMES: Record<string, string> = {
  Caliber545x39: '5.45x39',
  Caliber556x45NATO: '5.56x45 NATO',
  Caliber762x39: '7.62x39',
  Caliber762x51: '7.62x51 NATO',
  Caliber762x54R: '7.62x54R',
  Caliber9x18PM: '9x18 마카로프',
  Caliber9x19PARA: '9x19 파라벨럼',
  Caliber9x21: '9x21',
  Caliber9x39: '9x39',
  Caliber1143x23ACP: '.45 ACP',
  Caliber46x30: '4.6x30',
  Caliber57x28: '5.7x28',
  Caliber366TKM: '.366 TKM',
  Caliber127x55: '12.7x55',
  Caliber86x70: '.338 라푸아',
  Caliber762x35: '.300 블랙아웃',
  Caliber68x51: '6.8x51',
  Caliber762x25TT: '7.62x25 TT',
  Caliber9x33R: '.357 매그넘',
  Caliber12g: '12게이지',
  Caliber20g: '20게이지',
  Caliber23x75: '23x75',
}

function caliberLabel(caliber: string | null): string {
  if (!caliber) return '기타'
  return CALIBER_NAMES[caliber] ?? caliber.replace(/^Caliber/, '')
}

type SortKey = 'damage' | 'penetrationPower' | 'armorDamage' | 'price'

function sortValue(ammo: AmmoInfo, key: SortKey): number {
  if (key === 'price') return ammo.item.avg24hPrice ?? 0
  return ammo[key]
}

// 산탄은 펠릿당 데미지라 총 데미지로 환산해서 표시
function totalDamage(ammo: AmmoInfo): number {
  return ammo.damage * (ammo.projectileCount ?? 1)
}

// 방어구 클래스별 관통 효율 0~6 (커뮤니티 탄약 차트 방식의 근사식).
// 클래스 c의 기준 방어력을 c×10으로 보고, 관통력이 기준+15면 확실(6),
// 기준-15면 무력(0), 사이는 선형. 실전은 내구도·명중 각도에 따라 달라짐
function armorRating(pen: number, cls: number): number {
  return Math.max(0, Math.min(6, Math.round((pen - (cls * 10 - 15)) / 5)))
}

// C2~C6 한 줄 칩 — 데스크톱 표·모바일 카드 양쪽에서 같은 마크업 사용
function ArmorCells({ pen }: { pen: number }) {
  return (
    <span className="ammo-armor">
      {[2, 3, 4, 5, 6].map((cls) => {
        const r = armorRating(pen, cls)
        return (
          <span
            key={cls}
            className={`ammo-r ammo-r${r}`}
            title={`클래스 ${cls} 방어구 — 효율 ${r}/6`}
          >
            {r}
          </span>
        )
      })}
    </span>
  )
}

export function AmmoTab() {
  const state = useAsyncData(fetchAmmo)
  const [caliber, setCaliber] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('penetrationPower')

  const calibers = useMemo(() => {
    if (state.status !== 'ready') return []
    const unique = [...new Set(state.data.map((a) => a.caliber ?? ''))]
    return unique
      .map((c) => ({ value: c, label: caliberLabel(c || null) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  }, [state])

  const rows = useMemo(() => {
    if (state.status !== 'ready') return []
    const filtered = caliber
      ? state.data.filter((a) => (a.caliber ?? '') === caliber)
      : state.data
    return [...filtered].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey))
  }, [state, caliber, sortKey])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="탄약 데이터 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <ErrorState message={state.message} onRetry={state.reload} />
  }

  const sortableHeader = (key: SortKey, label: string) => (
    <th
      className="num sortable"
      onClick={() => setSortKey(key)}
      title="클릭하면 이 열 기준으로 정렬"
    >
      {label}
      {sortKey === key ? ' ▾' : ''}
    </th>
  )

  return (
    <div>
      <div className="toolbar">
        <select value={caliber} onChange={(e) => setCaliber(e.target.value)}>
          <option value="">전체 구경 ({state.data.length}종)</option>
          {calibers.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="hint">열 제목을 클릭하면 정렬 기준이 바뀜</span>
      </div>
      <p className="hint">
        <span className="ammo-legend">
          C2~C6 = 방어구 클래스별 관통 효율{' '}
          <span className="ammo-r ammo-r6">6</span>확실{' '}
          <span className="ammo-r ammo-r4">4</span>양호{' '}
          <span className="ammo-r ammo-r2">2</span>불안정{' '}
          <span className="ammo-r ammo-r0">0</span>튕김
        </span>{' '}
        — 근사 등급, 실전은 내구도·각도에 따라 달라짐 · 산탄은 펠릿 수를 곱한 총
        데미지 · ‘—’는 플리 거래 불가(상인/제작 전용)
      </p>
      <table className="data-table card-table">
        <thead>
          <tr>
            <th>탄약</th>
            <th>구경</th>
            {sortableHeader('damage', '데미지')}
            {sortableHeader('penetrationPower', '관통')}
            <th>방어구 효율 C2~C6</th>
            {sortableHeader('armorDamage', '방어구 손상')}
            {sortableHeader('price', '플리 평균가')}
          </tr>
        </thead>
        <tbody>
          {rows.map((ammo) => (
            <tr key={ammo.item.id}>
              <td>
                <ItemCell
                  iconLink={ammo.item.iconLink}
                  name={ammo.item.name}
                  shortName={ammo.item.shortName}
                />
              </td>
              <td className="dim" data-label="구경">{caliberLabel(ammo.caliber)}</td>
              <td className="num" data-label="데미지">
                <span className="ammo-stat">
                  {totalDamage(ammo)}
                  {(ammo.projectileCount ?? 1) > 1 && (
                    <span className="dim"> ({ammo.damage}×{ammo.projectileCount})</span>
                  )}
                  <span
                    className="ammo-bar"
                    style={{ width: `${Math.min(100, totalDamage(ammo) / 1.8)}%` }}
                    aria-hidden
                  />
                </span>
              </td>
              <td className="num" data-label="관통">
                <span className="ammo-stat">
                  {ammo.penetrationPower}
                  <span
                    className="ammo-bar pen"
                    style={{ width: `${Math.min(100, ammo.penetrationPower / 0.75)}%` }}
                    aria-hidden
                  />
                </span>
              </td>
              <td data-label="방어구 효율">
                <ArmorCells pen={ammo.penetrationPower} />
              </td>
              <td className="num" data-label="방어구 손상">{ammo.armorDamage}</td>
              <td className="num" data-label="플리 평균가">{formatRub(ammo.item.avg24hPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
