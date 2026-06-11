import { useState } from 'react'
import { SearchTab } from './features/SearchTab'

const TABS = [{ key: 'search', label: '아이템 검색', element: <SearchTab /> }] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const [active, setActive] = useState<TabKey>('search')

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
