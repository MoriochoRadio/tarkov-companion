import { useEffect, useRef, useState } from 'react'
import { AmmoTab } from './features/AmmoTab'
import { BriefingTab } from './features/BriefingTab'
import { Hero } from './features/Hero'
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

// 히어로 인트로는 "처음 온 사람"에게만 — 매일 쓰는 사람을 방해하지 않는 게 절대 원칙
function shouldShowHero(): boolean {
  try {
    if (localStorage.getItem('tc:visited')) return false
  } catch {
    return false // 저장이 안 되는 환경이면 매번 떠서 더 성가심 → 그냥 스킵
  }
  // 홈 화면에 설치해서 실행한 사람(PWA)은 이미 단골
  if (window.matchMedia('(display-mode: standalone)').matches) return false
  return true
}

export default function App() {
  const [active, setActive] = useState<TabKey>('briefing')
  const [showHero, setShowHero] = useState(shouldShowHero)

  const enterDashboard = () => {
    try {
      localStorage.setItem('tc:visited', '1')
    } catch {
      // 저장 실패해도 이번 세션은 정상 진행
    }
    setShowHero(false)
  }

  // 모바일에서 탭바가 잘려 있을 때 "오른쪽에 더 있음" 힌트 표시.
  // 끝까지 스크롤하면 숨김 — 스크롤 위치는 리렌더 없이 이벤트로만 추적
  const tabsRef = useRef<HTMLElement>(null)
  const [moreRight, setMoreRight] = useState(false)
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const update = () =>
      setMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 8)
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return (
    <>
      {showHero && <Hero onEnter={enterDashboard} />}
      <div className="app">
        <header className="app-header">
          <h1 className="logo">
            TARKOV<span className="logo-accent">&nbsp;COMPANION</span>
          </h1>
          <p className="tagline">Escape From Tarkov 한국어 시세·브리핑 대시보드</p>
        </header>
        <div className="tabs-wrap">
          <nav className="tabs" ref={tabsRef}>
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
          {moreRight && (
            <span className="tabs-more" aria-hidden>
              ›
            </span>
          )}
        </div>
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
    </>
  )
}
