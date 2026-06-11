import { useState } from 'react'
import { AmmoTab } from './features/AmmoTab'
import { BriefingTab } from './features/BriefingTab'
import { MoversTab } from './features/MoversTab'
import { SearchTab } from './features/SearchTab'
import { ValueTab } from './features/ValueTab'

const TABS = [
  { key: 'briefing', label: '오늘의 브리핑', element: <BriefingTab /> },
  { key: 'search', label: '아이템 검색', element: <SearchTab /> },
  { key: 'value', label: '가성비 랭킹', element: <ValueTab /> },
  { key: 'movers', label: '급등/급락', element: <MoversTab /> },
  { key: 'ammo', label: '탄약 비교', element: <AmmoTab /> },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const [active, setActive] = useState<TabKey>('briefing')

  return (
    <div className="app">
      <header className="app-header">
        <h1>Tarkov Companion</h1>
        <p className="tagline">Escape From Tarkov 시세·가성비 한국어 대시보드</p>
      </header>
      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={tab.key === active ? 'active' : ''}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="app-main">
        {TABS.find((tab) => tab.key === active)?.element}
      </main>
      <footer className="app-footer">
        시세 데이터:{' '}
        <a href="https://tarkov.dev" target="_blank" rel="noreferrer">
          tarkov.dev
        </a>{' '}
        (무료 공개 API) · 시세는 플리마켓 24시간 평균 기준
      </footer>
    </div>
  )
}
