// 히어로 배경 — canvas 2D: 떠다니는 재/연기 입자 + 레이더 스윕 그리드.
// WebGL 셰이더 안개도 검토했지만 저사양 기기의 컨텍스트 손실 처리와
// CPU 4x 스로틀 검증 부담 대비 이득이 없어 2D로 결정 (입자는 스프라이트
// 프리렌더, 격자는 오프스크린 1회 렌더라 프레임당 비용이 작음)

const GOLD = '201, 180, 130' // var(--accent) #c9b482
const ASH_GRAY = '176, 182, 188'

interface Ash {
  x: number
  y: number
  vy: number // px/s, 위로
  sway: number // 좌우 흔들림 속도
  phase: number
  r: number
  alpha: number
  gold: boolean
}

interface Smoke {
  x: number
  y: number
  vx: number
  r: number
  alpha: number
}

export interface HeroCanvasHandle {
  stop: () => void
  /** 탭 전환 등 한 번의 임팩트 — 레이더 링 1회 확산 + 입자 가속 후 감쇠 */
  pulse: () => void
}

export function startHeroCanvas(
  canvas: HTMLCanvasElement,
  { staticFrame = false, ambient = false } = {},
): HeroCanvasHandle {
  const ctx = canvas.getContext('2d')
  if (!ctx) return { stop: () => {}, pulse: () => {} }

  // 모바일은 입자 수 자동 축소.
  // ambient(대시보드 상시 배경)는 절반 — 도구 조작에 끼어들면 안 되는 배경이라
  const mobile = window.matchMedia('(max-width: 640px)').matches
  const scale = ambient ? 0.5 : 1
  const ASH_COUNT = Math.round((mobile ? 26 : 64) * scale)
  const SMOKE_COUNT = Math.round((mobile ? 4 : 7) * scale)
  const SWEEP_SEC = ambient ? 14 : 9 // 배경은 더 느긋하게

  let w = 0
  let h = 0
  let rafId = 0
  let last = performance.now()
  let sweep = -Math.PI / 2
  let grid: HTMLCanvasElement | null = null
  let pulseStart = -1 // 펄스 시작 시각(ms) — 음수면 비활성

  // 연기: 큰 라디얼 그라데이션 블롭을 스프라이트로 1회 렌더
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 256
  {
    const sctx = sprite.getContext('2d')!
    const g = sctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, 'rgba(140, 148, 156, 0.55)')
    g.addColorStop(0.55, 'rgba(140, 148, 156, 0.18)')
    g.addColorStop(1, 'rgba(140, 148, 156, 0)')
    sctx.fillStyle = g
    sctx.fillRect(0, 0, 256, 256)
  }

  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

  const ash: Ash[] = []
  const smoke: Smoke[] = []

  function spawnAsh(p: Ash, fromBottom: boolean) {
    p.x = rand(0, w)
    p.y = fromBottom ? h + rand(0, 30) : rand(0, h)
    p.vy = rand(7, 26)
    p.sway = rand(0.2, 0.9)
    p.phase = rand(0, Math.PI * 2)
    p.r = rand(0.5, 1.7)
    p.alpha = rand(0.06, 0.4)
    p.gold = Math.random() < 0.45
  }

  function buildGrid() {
    grid = document.createElement('canvas')
    grid.width = canvas.width
    grid.height = canvas.height
    const gctx = grid.getContext('2d')!
    gctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)

    // 미세 격자
    gctx.strokeStyle = `rgba(${GOLD}, 0.045)`
    gctx.lineWidth = 1
    const step = 72
    gctx.beginPath()
    for (let x = step; x < w; x += step) {
      gctx.moveTo(x, 0)
      gctx.lineTo(x, h)
    }
    for (let y = step; y < h; y += step) {
      gctx.moveTo(0, y)
      gctx.lineTo(w, y)
    }
    gctx.stroke()

    // 레이더 링 + 십자선 (스윕과 같은 중심)
    const cx = w * 0.5
    const cy = h * 0.42
    const R = Math.min(w, h) * 0.46
    gctx.strokeStyle = `rgba(${GOLD}, 0.07)`
    gctx.beginPath()
    for (let i = 1; i <= 4; i++) {
      gctx.moveTo(cx + (R * i) / 4, cy)
      gctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2)
    }
    gctx.moveTo(cx - R, cy)
    gctx.lineTo(cx + R, cy)
    gctx.moveTo(cx, cy - R)
    gctx.lineTo(cx, cy + R)
    gctx.stroke()
  }

  function resize() {
    w = window.innerWidth
    h = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75) // 과한 해상도는 비용만 큼
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    buildGrid()
  }

  function initParticles() {
    ash.length = 0
    smoke.length = 0
    for (let i = 0; i < ASH_COUNT; i++) {
      const p = {} as Ash
      spawnAsh(p, false)
      ash.push(p)
    }
    for (let i = 0; i < SMOKE_COUNT; i++) {
      smoke.push({
        x: rand(0, w),
        y: rand(h * 0.15, h * 0.95),
        vx: rand(-7, 7) || 3,
        r: rand(140, Math.max(220, w * 0.22)),
        alpha: rand(0.05, 0.11),
      })
    }
  }

  function drawSweep() {
    const cx = w * 0.5
    const cy = h * 0.42
    const R = Math.min(w, h) * 0.46
    // 스윕 꼬리 — conic gradient 미지원 브라우저는 선만
    if (typeof ctx!.createConicGradient === 'function') {
      const cg = ctx!.createConicGradient(sweep, cx, cy)
      cg.addColorStop(0, `rgba(${GOLD}, 0.11)`)
      cg.addColorStop(0.14, `rgba(${GOLD}, 0)`)
      cg.addColorStop(1, `rgba(${GOLD}, 0)`)
      ctx!.fillStyle = cg
      ctx!.beginPath()
      ctx!.moveTo(cx, cy)
      ctx!.arc(cx, cy, R, 0, Math.PI * 2)
      ctx!.fill()
    }
    // 진행 방향 선
    ctx!.strokeStyle = `rgba(${GOLD}, 0.28)`
    ctx!.lineWidth = 1
    ctx!.beginPath()
    ctx!.moveTo(cx, cy)
    ctx!.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R)
    ctx!.stroke()
  }

  const PULSE_MS = 1100

  // 펄스 진행도 0~1 (끝났으면 -1)
  function pulseProgress(now: number): number {
    if (pulseStart < 0) return -1
    const t = (now - pulseStart) / PULSE_MS
    if (t >= 1) {
      pulseStart = -1
      return -1
    }
    return t
  }

  function drawPulseRing(t: number) {
    const cx = w * 0.5
    const cy = h * 0.42
    const R = Math.min(w, h) * 0.46
    const ease = 1 - (1 - t) * (1 - t) // ease-out
    ctx!.strokeStyle = `rgba(${GOLD}, ${(0.4 * (1 - t)).toFixed(3)})`
    ctx!.lineWidth = 1.5
    ctx!.beginPath()
    ctx!.arc(cx, cy, R * ease, 0, Math.PI * 2)
    ctx!.stroke()
  }

  function draw(dt: number, now: number) {
    ctx!.clearRect(0, 0, w, h)
    if (grid) ctx!.drawImage(grid, 0, 0, w, h)

    for (const s of smoke) {
      s.x += s.vx * dt
      if (s.x < -s.r) s.x = w + s.r
      if (s.x > w + s.r) s.x = -s.r
      ctx!.globalAlpha = s.alpha
      ctx!.drawImage(sprite, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2)
    }
    ctx!.globalAlpha = 1

    // 정적 모드(reduced-motion)에서는 움직이는 스윕 생략
    if (!staticFrame) drawSweep()

    // 탭 전환 펄스 — 입자가 잠깐 빨라졌다 가라앉고, 골드 링이 1회 퍼짐
    const pt = staticFrame ? -1 : pulseProgress(now)
    const boost = pt < 0 ? 1 : 1 + 2.4 * (1 - pt) * (1 - pt)

    for (const p of ash) {
      p.y -= p.vy * dt * boost
      p.x += Math.sin(p.phase + now / 1000) * p.sway * dt * 14 * boost
      if (p.y < -8) spawnAsh(p, true)
      ctx!.globalAlpha = p.alpha
      ctx!.fillStyle = p.gold ? `rgb(${GOLD})` : `rgb(${ASH_GRAY})`
      ctx!.fillRect(p.x, p.y, p.r, p.r)
    }
    ctx!.globalAlpha = 1

    if (pt >= 0) drawPulseRing(pt)
  }

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05) // 탭 복귀 직후 점프 방지
    last = now
    sweep += dt * ((Math.PI * 2) / SWEEP_SEC)
    draw(dt, now)
    rafId = requestAnimationFrame(frame)
  }

  // 탭이 안 보이면 멈춤 (배터리/CPU 절약)
  function onVisibility() {
    if (staticFrame) return
    if (document.hidden) {
      cancelAnimationFrame(rafId)
    } else {
      last = performance.now()
      rafId = requestAnimationFrame(frame)
    }
  }

  function onResize() {
    resize()
    initParticles()
    if (staticFrame) draw(0, performance.now())
  }

  resize()
  initParticles()
  if (staticFrame) {
    // prefers-reduced-motion: 움직임 없는 한 프레임만
    draw(0, performance.now())
  } else {
    rafId = requestAnimationFrame(frame)
    document.addEventListener('visibilitychange', onVisibility)
  }
  window.addEventListener('resize', onResize)

  return {
    stop: () => {
      cancelAnimationFrame(rafId)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
    },
    pulse: () => {
      if (staticFrame) return
      pulseStart = performance.now()
    },
  }
}
