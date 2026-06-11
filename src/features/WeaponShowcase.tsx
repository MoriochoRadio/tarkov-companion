import { useEffect, useRef, useState } from 'react'
import type { ViewerHandle } from '../lib/weaponViewer'
import { WEAPON_CREDIT, WEAPONS } from '../lib/weapons'

// 3D 무기 쇼케이스 — three.js는 여기서만, 반드시 지연 dynamic import.
// 첫 페인트 번들에는 이 파일(소량)만 들어가고 three(~170KB gz)는 별도 청크.

// 모바일·저사양·WebGL 미지원은 3D 대신 사전 렌더 포스터
function supports3D(): boolean {
  if (window.matchMedia('(max-width: 640px)').matches) return false
  if ((navigator.hardwareConcurrency ?? 8) <= 2) return false
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

// 공용 3D 스테이지 — canvas 수명/폴백/무기 전환을 관리
function WeaponStage({
  index,
  interactive,
  delay,
  variant,
}: {
  index: number
  interactive: boolean
  delay: number // three 로드를 미루는 시간(ms) — 첫 페인트와 경쟁 금지
  variant: 'hero' | 'widget' | 'modal'
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<ViewerHandle | null>(null)
  const indexRef = useRef(index)
  const [poster, setPoster] = useState(() => !supports3D())

  useEffect(() => {
    if (poster) return
    let cancelled = false
    const t = setTimeout(() => {
      import('../lib/weaponViewer')
        .then(({ createViewer }) => {
          if (cancelled || !canvasRef.current) return
          const reduced = window.matchMedia(
            '(prefers-reduced-motion: reduce)',
          ).matches
          const viewer = createViewer(canvasRef.current, {
            autoRotate: !reduced, // reduced-motion이면 자동 회전 정지 (드래그는 가능)
            interactive,
            onContextLost: () => setPoster(true),
          })
          viewerRef.current = viewer
          return viewer.loadWeapon(WEAPONS[indexRef.current].file)
        })
        .catch(() => {
          if (!cancelled) setPoster(true) // 로드 실패 → 포스터
        })
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(t)
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 무기 전환 — 뷰어가 페이드아웃→페이드인 처리
  useEffect(() => {
    indexRef.current = index
    viewerRef.current?.loadWeapon(WEAPONS[index].file).catch(() => {})
  }, [index])

  return (
    // 주의: variant를 맨몸 클래스로 쓰면 .hero(풀스크린 오버레이)와 충돌함 — 프리픽스 필수
    <span className={`weapon-stage stage-${variant}`}>
      {poster ? (
        <img
          className="weapon-poster"
          src={WEAPONS[index].poster}
          alt={`${WEAPONS[index].name} 3D 모델`}
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="weapon-canvas"
          aria-label={`${WEAPONS[index].name} 3D 모델${interactive ? ' — 드래그로 회전' : ''}`}
        />
      )}
    </span>
  )
}

// 히어로 중앙(로고 아래) — 자동 회전 + 드래그, 전환 버튼
export function HeroWeapon() {
  const [idx, setIdx] = useState(0)
  return (
    <div className="hero-weapon">
      <WeaponStage index={idx} interactive delay={1100} variant="hero" />
      <button
        className="weapon-switch"
        onClick={() => setIdx((i) => (i + 1) % WEAPONS.length)}
        title="다음 무기로 전환"
      >
        ⟳ {WEAPONS[idx].name}
      </button>
    </div>
  )
}

// 풀스크린 뷰어
function WeaponModal({ onClose }: { onClose: () => void }) {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="weapon-modal"
      role="dialog"
      aria-label="3D 무기 뷰어"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <button className="quest-back weapon-close" onClick={onClose}>
        ✕ 닫기 (Esc)
      </button>
      <WeaponStage index={idx} interactive delay={0} variant="modal" />
      <div className="weapon-controls">
        <button
          className="quest-back"
          onClick={() => setIdx((i) => (i - 1 + WEAPONS.length) % WEAPONS.length)}
          aria-label="이전 무기"
        >
          ◀
        </button>
        <span className="weapon-name">{WEAPONS[idx].name}</span>
        <button
          className="quest-back"
          onClick={() => setIdx((i) => (i + 1) % WEAPONS.length)}
          aria-label="다음 무기"
        >
          ▶
        </button>
      </div>
      <p className="weapon-credit">
        드래그로 회전 ·{' '}
        <a href={WEAPON_CREDIT.url} target="_blank" rel="noreferrer">
          {WEAPON_CREDIT.text}
        </a>
      </p>
    </div>
  )
}

// 대시보드 헤더 우측 — 작게 떠서 자동 회전, 클릭하면 풀스크린
export function WeaponWidget() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="weapon-widget"
        onClick={() => setOpen(true)}
        title="3D 무기 뷰어 열기"
      >
        <WeaponStage index={0} interactive={false} delay={3000} variant="widget" />
      </button>
      {open && <WeaponModal onClose={() => setOpen(false)} />}
    </>
  )
}
