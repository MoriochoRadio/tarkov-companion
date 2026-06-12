import { useEffect, useRef, useState } from 'react'
import { fetchBriefingDates } from '../api/briefings'
import { fetchCounts } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { startHeroCanvas } from '../lib/heroCanvas'
import { CountUp } from './CountUp'
import { HeroWeapon } from './WeaponShowcase'

// 풀스크린 히어로 인트로 — 첫 방문자 전용 (게이트는 App.tsx의 shouldShowHero).
// 절대 원칙: 매일 쓰는 사람을 방해하지 않는다 — 재방문/PWA에선 아예 안 뜸

function Stat({
  value,
  label,
  delay,
}: {
  value: number | null
  label: string
  delay: number
}) {
  return (
    <div className="hero-stat" style={{ animationDelay: `${delay}ms` }}>
      <span className="hero-stat-num num">
        {value == null ? '—' : <CountUp value={value} />}
      </span>
      <span className="hero-stat-label">{label}</span>
    </div>
  )
}

export function Hero({ onEnter }: { onEnter: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [leaving, setLeaving] = useState(false)
  const leavingRef = useRef(false) // 이벤트 리스너의 stale closure 방지

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const statsState = useAsyncData(async () => {
    const [counts, dates] = await Promise.all([fetchCounts(), fetchBriefingDates()])
    return { ...counts, briefings: dates.length }
  })
  const stats = statsState.status === 'ready' ? statsState.data : null

  function beginLeave() {
    if (leavingRef.current) return
    leavingRef.current = true
    if (reduced) {
      onEnter() // 즉시 입장 — 페이드 생략
      return
    }
    setLeaving(true) // CSS opacity 전환 → onTransitionEnd에서 onEnter
  }

  // 배경 canvas (reduced-motion이면 정적 한 프레임)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return startHeroCanvas(canvas, { staticFrame: reduced }).stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 스크롤(휠/터치)·키보드로도 입장 + 히어로 떠 있는 동안 본문 스크롤 잠금
  useEffect(() => {
    const go = () => beginLeave()
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'ArrowDown', 'Escape'].includes(e.key)) beginLeave()
    }
    window.addEventListener('wheel', go, { passive: true })
    window.addEventListener('touchmove', go, { passive: true })
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('wheel', go)
      window.removeEventListener('touchmove', go)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section
      className={`hero${leaving ? ' leaving' : ''}`}
      aria-label="Tarkov Companion 소개"
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && leaving) onEnter()
      }}
    >
      <canvas ref={canvasRef} className="hero-canvas" aria-hidden />
      <div className="hero-content">
        <p className="hero-kicker">Escape From Tarkov · Korean Companion</p>
        <h1 className="hero-logo">
          TARKOV<span className="logo-accent">&nbsp;COMPANION</span>
        </h1>
        <div className="hero-rule" aria-hidden />
        <HeroWeapon />
        <p className="hero-sub">
          실시간 플리마켓 시세 · 가성비 분석 · 매일 아침 AI 브리핑
        </p>
        <div className="hero-stats">
          {/* 로고 리빌(~1.2s)이 끝난 뒤 하나씩 등장 */}
          <Stat value={stats?.items ?? null} label="추적 중 아이템" delay={1250} />
          <Stat value={stats?.briefings ?? null} label="발행한 브리핑" delay={1370} />
          <Stat value={stats?.quests ?? null} label="수록 퀘스트" delay={1490} />
        </div>
        <button className="hero-enter" onClick={beginLeave} autoFocus>
          입장하기
        </button>
        <p className="hero-hint">스크롤해도 바로 입장됩니다</p>
      </div>
    </section>
  )
}
