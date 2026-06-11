import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AmbientBackground } from './features/AmbientBackground'
import { AmmoTab } from './features/AmmoTab'
import { BriefingTab } from './features/BriefingTab'
import { Hero } from './features/Hero'
import { MapsTab } from './features/MapsTab'
import { MoversTab } from './features/MoversTab'
import { QuestsTab } from './features/QuestsTab'
import { SearchTab } from './features/SearchTab'
import { TickerBar } from './features/TickerBar'
import { ValueTab } from './features/ValueTab'
import { WeaponWidget } from './features/WeaponShowcase'
import { setPendingSearch } from './lib/searchSeed'

const TABS = [
  { key: 'briefing', label: '오늘의 브리핑', Comp: BriefingTab },
  { key: 'search', label: '아이템 검색', Comp: SearchTab },
  { key: 'value', label: '가성비 랭킹', Comp: ValueTab },
  { key: 'movers', label: '급등/급락', Comp: MoversTab },
  { key: 'ammo', label: '탄약 비교', Comp: AmmoTab },
  { key: 'quests', label: '퀘스트', Comp: QuestsTab },
  { key: 'maps', label: '맵', Comp: MapsTab },
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
  // 검색 탭에 이미 있을 때도 티커 클릭이 반영되도록 리마운트용 논스
  const [searchNonce, setSearchNonce] = useState(0)
  // 티커(아이템 1.3MB)는 첫 페인트와 경쟁하지 않게 잠깐 늦게 켬
  const [tickerOn, setTickerOn] = useState(false)

  const enterDashboard = () => {
    try {
      localStorage.setItem('tc:visited', '1')
    } catch {
      // 저장 실패해도 이번 세션은 정상 진행
    }
    setShowHero(false)
  }

  useEffect(() => {
    const t = setTimeout(() => setTickerOn(true), 1500)
    return () => clearTimeout(t)
  }, [])

  const pickFromTicker = (name: string) => {
    setPendingSearch(name)
    setSearchNonce((n) => n + 1)
    setActive('search')
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

  // 활성 탭 밑줄을 슬라이딩 인디케이터로 — translateX/scaleX만 써서 레이아웃 비용 0
  const indicatorRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const nav = tabsRef.current
    const ind = indicatorRef.current
    const btn = nav?.querySelector<HTMLButtonElement>('button.active')
    if (!nav || !ind || !btn) return
    const place = () => {
      ind.style.transform = `translateX(${btn.offsetLeft}px) scaleX(${btn.offsetWidth})`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [active])

  const activeTab = TABS.find((tab) => tab.key === active) ?? TABS[0]
  const ActiveComp = activeTab.Comp

  return (
    <>
      {showHero && <Hero onEnter={enterDashboard} />}
      {!showHero && <AmbientBackground />}
      <div className="app">
        <header className="app-header">
          <h1 className="logo">
            TARKOV<span className="logo-accent">&nbsp;COMPANION</span>
          </h1>
          <p className="tagline">Escape From Tarkov 한국어 시세·브리핑 대시보드</p>
          <WeaponWidget />
        </header>
        {/* 로딩 전에도 같은 높이의 빈 바를 둬서 레이아웃 시프트 방지 */}
        {tickerOn ? (
          <TickerBar onPick={pickFromTicker} />
        ) : (
          <div className="ticker" aria-hidden />
        )}
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
            <span className="tab-indicator" ref={indicatorRef} aria-hidden />
          </nav>
          {moreRight && (
            <span className="tabs-more" aria-hidden>
              ›
            </span>
          )}
        </div>
        <main className="app-main">
          <ActiveComp
            key={active === 'search' ? `search-${searchNonce}` : active}
          />
        </main>
        <footer className="app-footer">
          <span>
            비공식 팬 프로젝트 · Battlestate Games와 무관 · 데이터:{' '}
            <a href="https://tarkov.dev" target="_blank" rel="noreferrer">
              tarkov.dev
            </a>{' '}
            · 3D 모델:{' '}
            <a href="https://quaternius.com" target="_blank" rel="noreferrer">
              Quaternius (CC0)
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
