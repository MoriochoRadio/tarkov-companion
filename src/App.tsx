import { useState } from 'react'
import { AmmoTab } from './features/AmmoTab'
import { BriefingTab } from './features/BriefingTab'
import { MapsTab } from './features/MapsTab'
import { MoversTab } from './features/MoversTab'
import { QuestsTab } from './features/QuestsTab'
import { SearchTab } from './features/SearchTab'
import { ValueTab } from './features/ValueTab'

const TABS = [
  { key: 'briefing', label: '오늘의 브리핑', element: <BriefingTab /> },
  { key: 'search', label: '아이템 검색', element: <SearchTab /> },
  { key: 'value', label: '가성비 랭킹', element: <ValueTab /> },
  { key: 'movers', label: '급등/급락', element: <MoversTab /> },
  { key: 'ammo', label: '탄약 비교', element: <AmmoTab /> },
  { key: 'quests', label: '퀘스트', element: <QuestsTab /> },
  { key: 'maps', label: '맵', element: <MapsTab /> },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const [active, setActive] = useState<TabKey>('briefing')

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="logo">
          TARKOV<span className="logo-accent">&nbsp;COMPANION</span>
        </h1>
        <p className="tagline">Escape From Tarkov 한국어 시세·브리핑 대시보드</p>
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
        <span>
          비공식 팬 프로젝트 · Battlestate Games와 무관 · 데이터:{' '}
          <a href="https://tarkov.dev" target="_blank" rel="noreferrer">
            tarkov.dev
          </a>
        </span>
        <a
          href="https://github.com/MoriochoRadio/tarkov-companion"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
      </footer>
    </div>
  )
}
