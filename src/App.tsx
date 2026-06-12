import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'
import { AmbientBackground, pulseAmbient } from './features/AmbientBackground'
import { AmmoTab } from './features/AmmoTab'
import { BriefingTab } from './features/BriefingTab'
import { CommandPalette } from './features/CommandPalette'
import { DataManager } from './features/DataManager'
import { Hero } from './features/Hero'
import { MapsTab } from './features/MapsTab'
import { ModdingTab } from './features/ModdingTab'
import { MoversTab } from './features/MoversTab'
import { PlannerTab } from './features/PlannerTab'
import { PrepTab } from './features/PrepTab'
import { ProfitTab } from './features/ProfitTab'
import { QuestsTab } from './features/QuestsTab'
import { SearchTab } from './features/SearchTab'
import { TickerBar } from './features/TickerBar'
import { TrackerTab } from './features/TrackerTab'
import { UnlocksTab } from './features/UnlocksTab'
import { ValueTab } from './features/ValueTab'
import { startAlertPoller } from './lib/alertPoller'
import { setPendingQuest, setPendingSearch } from './lib/searchSeed'
import { installSpotlight } from './lib/spotlight'

// eyebrow: 마스트헤드 위에 얹는 영문 모노 라벨 — 잡지 코너명처럼.
// 순서는 그룹 내비(GROUPS) 순서와 맞춤 — 마스트헤드 번호가 그룹 흐름대로 매겨지게
const TABS = [
  { key: 'briefing', label: '오늘의 브리핑', eyebrow: 'DAILY BRIEFING', Comp: BriefingTab },
  { key: 'quests', label: '퀘스트', eyebrow: 'TASK DATABASE', Comp: QuestsTab },
  { key: 'prep', label: '준비물', eyebrow: 'RAID CHECKLIST', Comp: PrepTab },
  { key: 'tracker', label: 'FIR 트래커', eyebrow: 'FIR TRACKER', Comp: TrackerTab },
  { key: 'planner', label: '플래너', eyebrow: 'RAID PLANNER', Comp: PlannerTab },
  { key: 'unlocks', label: '해금', eyebrow: 'OFFER UNLOCKS', Comp: UnlocksTab },
  { key: 'search', label: '아이템 검색', eyebrow: 'ITEM SEARCH', Comp: SearchTab },
  { key: 'value', label: '가성비 랭킹', eyebrow: 'VALUE PER SLOT', Comp: ValueTab },
  { key: 'movers', label: '급등/급락', eyebrow: 'MARKET MOVERS', Comp: MoversTab },
  { key: 'profit', label: '돈벌이', eyebrow: 'PROFIT LAB', Comp: ProfitTab },
  { key: 'ammo', label: '탄약 비교', eyebrow: 'AMMO CHART', Comp: AmmoTab },
  { key: 'modding', label: '모딩', eyebrow: 'MOD WORKSHOP', Comp: ModdingTab },
  { key: 'maps', label: '맵', eyebrow: 'MAP INTEL', Comp: MapsTab },
] as const

type TabKey = (typeof TABS)[number]['key']

// 탭 11개를 도구 성격대로 묶은 2단 내비 — 기능 삭제 없이 재배치(Phase 23).
// 그룹에 탭이 하나뿐이면 서브 탭 줄은 숨긴다 (그룹 탭 자체가 목적지)
const GROUPS: readonly {
  key: string
  label: string
  tabs: readonly TabKey[]
}[] = [
  { key: 'briefing', label: '브리핑', tabs: ['briefing'] },
  { key: 'quest-tools', label: '퀘스트 도구', tabs: ['quests', 'prep', 'tracker', 'planner', 'unlocks'] },
  { key: 'market-tools', label: '시세 도구', tabs: ['search', 'value', 'movers', 'profit', 'ammo'] },
  { key: 'modding', label: '모딩', tabs: ['modding'] },
  { key: 'maps', label: '맵', tabs: ['maps'] },
]

const groupOf = (key: TabKey) =>
  GROUPS.find((g) => g.tabs.includes(key)) ?? GROUPS[0]

// 가로 스크롤 내비가 잘려 있을 때 "오른쪽에 더 있음" 힌트 — 그룹/서브 두 줄이 공유.
// dep: 줄의 내용물이 바뀌는 키 (서브 탭 줄은 그룹이 바뀌면 폭이 달라짐)
function useMoreRight(ref: RefObject<HTMLElement | null>, dep: string): boolean {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () =>
      setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 8)
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [ref, dep])
  return more
}

// 마스트헤드의 거대한 날짜 — 브리핑 탭 전용 (모노 숫자)
function mastheadDate(): string {
  const d = new Date()
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()]
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${weekday}`
}

// 탭 진입을 알리는 화면급 디스플레이 타이포 — "인터랙티브 매거진"의 마스트헤드.
// 글자 단위 스태거 등장(키네틱 타이포) — App에서 key={active}로 리마운트되어
// 탭을 바꿀 때마다 다시 재생됨. 스크린리더에는 통짜 라벨만 들림
function Masthead({ tab, index }: { tab: (typeof TABS)[number]; index: number }) {
  return (
    <header className="masthead">
      <p className="masthead-eyebrow">
        <span className="masthead-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="masthead-rule" aria-hidden />
        <span className="masthead-eyebrow-text">{tab.eyebrow}</span>
      </p>
      <h2 className="masthead-title" aria-label={tab.label}>
        <span className="masthead-kinetic" aria-hidden>
          {[...tab.label].map((ch, i) => (
            <span
              key={i}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </span>
        <span className="masthead-dot" aria-hidden>
          .
        </span>
      </h2>
      {tab.key === 'briefing' && (
        <p className="masthead-date">{mastheadDate()}</p>
      )}
    </header>
  )
}

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
  const [questNonce, setQuestNonce] = useState(0)
  // 티커(아이템 1.3MB)는 첫 페인트와 경쟁하지 않게 잠깐 늦게 켬
  const [tickerOn, setTickerOn] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

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

  // 카드 커서 스포트라이트 (데스크톱 + 모션 허용 환경 한정)
  useEffect(() => installSpotlight(), [])

  // 가격 알림 폴러 — 알림이 걸려 있을 때만 실제 요청 발생
  useEffect(() => startAlertPoller(), [])

  // 진행도(localStorage)가 저장 공간 정리로 지워지지 않게 영구 보관 요청.
  // 크롬은 프롬프트 없이 사용 빈도 기준으로 조용히 승인/거절함
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {})
  }, [])

  // Ctrl/Cmd+K — 빠른 검색 팔레트
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 그룹을 다시 눌렀을 때 마지막에 보던 서브 탭으로 복귀 (세션 한정 — 저장 안 함)
  const lastSubRef = useRef<Record<string, TabKey>>({})

  // 탭 전환 = 장면 전환: View Transitions로 화면이 와이프되고, 배경 레이더가 1회 펄스
  const switchTab = (key: TabKey, before?: () => void) => {
    lastSubRef.current[groupOf(key).key] = key
    const apply = () => {
      before?.()
      setActive(key)
    }
    if (key === active && !before) return
    pulseAmbient()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduced && document.startViewTransition) {
      // React 상태 갱신을 스냅샷 안에서 동기로 끝내야 전환이 잡힘
      document.startViewTransition(() => {
        flushSync(apply)
      })
    } else {
      apply()
    }
  }

  const pickFromTicker = (name: string) => {
    switchTab('search', () => {
      setPendingSearch(name)
      setSearchNonce((n) => n + 1)
    })
  }

  const pickQuest = (id: string) => {
    switchTab('quests', () => {
      setPendingQuest(id)
      setQuestNonce((n) => n + 1)
    })
  }

  const activeGroup = groupOf(active)

  // 두 줄 다 가로 스크롤 가능 — 잘려 있으면 "오른쪽에 더 있음" 힌트
  const tabsRef = useRef<HTMLElement>(null)
  const subRef = useRef<HTMLElement>(null)
  const moreRight = useMoreRight(tabsRef, 'groups')
  const subMoreRight = useMoreRight(subRef, activeGroup.key)

  // 활성 그룹 밑줄을 슬라이딩 인디케이터로 — translateX/scaleX만 써서 레이아웃 비용 0
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

  const activeIndex = Math.max(
    0,
    TABS.findIndex((tab) => tab.key === active),
  )
  const activeTab = TABS[activeIndex]
  // onQuest를 일괄 전달하기 위한 캐스트 — 현재 소비자는 해금 탭뿐이고,
  // 나머지 탭은 props를 선언하지 않아 무시함 (런타임 무해)
  const ActiveComp = activeTab.Comp as ComponentType<{
    onQuest?: (id: string) => void
  }>
  const tabLabel = (key: TabKey) => TABS.find((t) => t.key === key)?.label ?? key

  return (
    <>
      {showHero && <Hero onEnter={enterDashboard} />}
      {!showHero && <AmbientBackground />}
      {/* 페이지 스크롤 진행 바 — CSS scroll() 타임라인 전용, 미지원이면 안 보임 */}
      <div className="scroll-progress" aria-hidden />
      <div className="app">
        <header className="app-header">
          <h1 className="logo">
            TARKOV<span className="logo-accent">&nbsp;COMPANION</span>
          </h1>
          <p className="tagline">Escape From Tarkov 한국어 시세·브리핑 대시보드</p>
          <button
            className="palette-btn"
            onClick={() => setPaletteOpen(true)}
            aria-label="빠른 검색 열기"
          >
            <span aria-hidden>⌕</span> 빠른 검색
            <kbd>Ctrl K</kbd>
          </button>
        </header>
        {/* 로딩 전에도 같은 높이의 빈 바를 둬서 레이아웃 시프트 방지 */}
        {tickerOn ? (
          <TickerBar onPick={pickFromTicker} />
        ) : (
          <div className="ticker" aria-hidden />
        )}
        <div className="tabs-wrap">
          <div className="nav-row">
            <nav className="tabs group-tabs" ref={tabsRef} aria-label="도구 그룹">
              {GROUPS.map((g) => (
                <button
                  key={g.key}
                  className={g.key === activeGroup.key ? 'active' : ''}
                  onClick={() =>
                    switchTab(lastSubRef.current[g.key] ?? g.tabs[0])
                  }
                >
                  {g.label}
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
          {activeGroup.tabs.length > 1 && (
            <div className="nav-row">
              <nav
                className="sub-tabs"
                ref={subRef}
                aria-label={`${activeGroup.label} 탭`}
              >
                {activeGroup.tabs.map((key) => (
                  <button
                    key={key}
                    className={key === active ? 'active' : ''}
                    onClick={() => switchTab(key)}
                  >
                    {tabLabel(key)}
                  </button>
                ))}
              </nav>
              {subMoreRight && (
                <span className="tabs-more" aria-hidden>
                  ›
                </span>
              )}
            </div>
          )}
        </div>
        <main className="app-main">
          {/* key로 리마운트 → 키네틱 타이포가 탭 전환마다 재생.
              형제인 ActiveComp의 key(탭 키 그대로)와 겹치면 React 재조정이
              깨져 옛 마스트헤드가 DOM에 남음 — 반드시 접두사로 구분 */}
          <Masthead key={`mast-${active}`} tab={activeTab} index={activeIndex} />
          <ActiveComp
            key={
              active === 'search'
                ? `search-${searchNonce}`
                : active === 'quests'
                  ? `quests-${questNonce}`
                  : active
            }
            onQuest={pickQuest}
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
          <span className="footer-actions">
            <DataManager />
            <a
              href="https://github.com/MoriochoRadio/tarkov-companion"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </span>
        </footer>
      </div>
      {paletteOpen && (
        <CommandPalette
          tabs={TABS}
          onTab={(key) => switchTab(key as TabKey)}
          onItem={pickFromTicker}
          onQuest={pickQuest}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </>
  )
}
