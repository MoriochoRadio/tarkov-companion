import { useMemo, useState } from 'react'
import { fetchAmmo, type AmmoInfo } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatRub } from '../lib/format'
import { ItemCell } from './ItemRow'

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
    return <p className="status">탄약 데이터 불러오는 중…</p>
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
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
        관통력이 방어구 상대 핵심 지표 · 산탄은 펠릿 수를 곱한 총 데미지 표시 ·
        ‘—’는 플리마켓 거래 불가(상인/제작 전용)
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>탄약</th>
            <th>구경</th>
            {sortableHeader('damage', '데미지')}
            {sortableHeader('penetrationPower', '관통')}
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
              <td className="dim">{caliberLabel(ammo.caliber)}</td>
              <td className="num">
                {totalDamage(ammo)}
                {(ammo.projectileCount ?? 1) > 1 && (
                  <span className="dim"> ({ammo.damage}×{ammo.projectileCount})</span>
                )}
              </td>
              <td className="num">{ammo.penetrationPower}</td>
              <td className="num">{ammo.armorDamage}</td>
              <td className="num">{formatRub(ammo.item.avg24hPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
