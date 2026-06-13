import { useEffect, useMemo, useRef, useState } from 'react'
import { makeProjector, type MapMeta } from '../lib/mapProject'

// 맵 뷰어 (Phase 26) — SVG 지도 + 퀘스트 목표 마커 오버레이.
// 팬·줌은 단일 레이어의 CSS transform만 갱신 (React 리렌더 0회) —
// 마커는 --inv 변수로 역스케일해 화면 크기를 유지한다.
// SVG는 우리 저장소 수록본(public/maps, CC BY-NC-SA 4.0 — LICENSE.md)이며
// 마커는 런타임 오버레이로만 그려 파생 파일을 만들지 않는다.

// 마커 팝오버의 "필요 열쇠" 칩 — 표시명(biName)과 검색어(한국어명)를 미리 담아
// MapViewer가 quests API를 모르게 한다 (Phase 28)
export interface MarkerKey {
  id: string
  label: string // "한국어 (English)"
  search: string // 아이템 검색으로 보낼 이름
  iconLink: string | null
}

export interface ViewMarker {
  key: string
  x: number
  z: number
  icon: string // 6분류 이모지 (플래너와 공유)
  color: string // 퀘스트별 색
  questName: string
  desc: string
  // 잠긴 목표의 필요 열쇠 — [[Key]] 그룹 배열(그룹 간 AND, 그룹 내 OR). 없으면 숨김
  keys?: MarkerKey[][]
}

const ZOOM_MIN_FACTOR = 0.5 // 초기 핏 대비
const ZOOM_MAX = 14

// SVG 텍스트 세션 캐시 — 토글을 껐다 켜도 재요청 없음
const svgCache = new Map<string, Promise<string>>()

function fetchSvg(url: string): Promise<string> {
  let p = svgCache.get(url)
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`SVG 응답 오류 (HTTP ${res.status})`)
      return res.text()
    })
    p.catch(() => svgCache.delete(url))
    svgCache.set(url, p)
  }
  return p
}

export function MapViewer({
  meta,
  svgUrl,
  markers,
  onItem,
}: {
  meta: MapMeta
  svgUrl: string
  markers: ViewMarker[]
  onItem?: (name: string) => void // 열쇠 클릭 → 아이템 검색으로 이동
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const svgHostRef = useRef<HTMLDivElement>(null)
  const [svgState, setSvgState] = useState<'loading' | 'ready' | 'error'>('loading')
  // 보이는 층(svgLayer id) — 기본은 메타의 show=true 층만
  const [floors, setFloors] = useState<ReadonlySet<string>>(
    () => new Set(meta.layers.filter((l) => l.show).map((l) => l.svgLayer)),
  )
  const [pop, setPop] = useState<{
    m: ViewMarker
    left: number
    top: number
  } | null>(null)

  const proj = useMemo(() => makeProjector(meta), [meta])

  // --- 팬·줌 상태: ref + 직접 스타일 갱신 (리렌더 금지) ---
  const view = useRef({ x: 0, y: 0, s: 1, fit: 1 })
  const apply = () => {
    const l = layerRef.current
    if (!l) return
    const v = view.current
    l.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`
    l.style.setProperty('--inv', String(1 / v.s))
  }
  const clampZoom = (s: number) =>
    Math.min(ZOOM_MAX, Math.max(view.current.fit * ZOOM_MIN_FACTOR, s))
  const zoomAt = (cx: number, cy: number, factor: number) => {
    const v = view.current
    const ns = clampZoom(v.s * factor)
    const k = ns / v.s
    v.x = cx - (cx - v.x) * k
    v.y = cy - (cy - v.y) * k
    v.s = ns
    setPop(null)
    apply()
  }
  const fitView = () => {
    const wrap = wrapRef.current
    if (!wrap) return
    const cw = wrap.clientWidth
    const ch = wrap.clientHeight
    const s = Math.min(cw / proj.rect.w, ch / proj.rect.h) * 0.96
    view.current = {
      x: (cw - proj.rect.w * s) / 2,
      y: (ch - proj.rect.h * s) / 2,
      s,
      fit: s,
    }
    apply()
  }

  // SVG 로드 + 주입 — 맵 보기를 켰을 때만 (lazy)
  useEffect(() => {
    let on = true
    setSvgState('loading')
    fetchSvg(svgUrl)
      .then((text) => {
        if (!on || !svgHostRef.current) return
        svgHostRef.current.innerHTML = text // 우리 저장소 수록 에셋 — 외부 입력 아님
        const svg = svgHostRef.current.querySelector('svg')
        if (svg) {
          svg.setAttribute('width', '100%')
          svg.setAttribute('height', '100%')
          // 경계 사각형에 정확히 맞춰 늘림 (leaflet imageOverlay와 동일)
          svg.setAttribute('preserveAspectRatio', 'none')
        }
        setSvgState('ready')
        fitView()
      })
      .catch(() => on && setSvgState('error'))
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgUrl])

  // 층 표시 토글 — SVG 그룹 display 직접 제어
  useEffect(() => {
    const host = svgHostRef.current
    if (!host || svgState !== 'ready') return
    for (const l of meta.layers) {
      const g = host.querySelector<SVGGElement>(`g[id="${l.svgLayer}"]`)
      if (g) g.style.display = floors.has(l.svgLayer) ? '' : 'none'
    }
  }, [floors, svgState, meta.layers])

  // 리사이즈 시 다시 핏
  useEffect(() => {
    const onResize = () => fitView()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj])

  // --- 포인터 팬 + 핀치 줌 + 더블탭 ---
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const pointers = new Map<number, { x: number; y: number }>()
    let pinchDist = 0
    let lastTap = { t: 0, x: 0, y: 0 }
    let moved = false

    const rel = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onDown = (e: PointerEvent) => {
      // 마커·팝오버·전체 버튼 위에서는 팬을 시작하지 않음 — 포인터 캡처가
      // 걸리면 click이 캡처 대상(wrap)으로 가서 버튼 클릭이 죽는다 (실측)
      if ((e.target as Element).closest?.('.mapmark, .mapmark-pop, .mapview-fit')) {
        return
      }
      wrap.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, rel(e))
      moved = false
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const cur = rel(e)
      pointers.set(e.pointerId, cur)
      if (pointers.size === 1) {
        if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 2) moved = true
        view.current.x += cur.x - prev.x
        view.current.y += cur.y - prev.y
        if (moved) setPop(null)
        apply()
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0 && d > 0) {
          zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist)
        }
        pinchDist = d
        moved = true
      }
    }
    const onUp = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      pointers.delete(e.pointerId)
      pinchDist = 0
      // 더블탭 줌 (모바일 dblclick 미발화 환경 폴백)
      if (p && !moved && e.pointerType === 'touch') {
        const now = Date.now()
        if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 36) {
          zoomAt(p.x, p.y, 2)
          lastTap = { t: 0, x: 0, y: 0 }
        } else {
          lastTap = { t: now, x: p.x, y: p.y }
        }
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = wrap.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016))
    }
    const onDbl = (e: MouseEvent) => {
      const r = wrap.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, 2)
    }
    wrap.addEventListener('pointerdown', onDown)
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerup', onUp)
    wrap.addEventListener('pointercancel', onUp)
    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('dblclick', onDbl)
    return () => {
      wrap.removeEventListener('pointerdown', onDown)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerup', onUp)
      wrap.removeEventListener('pointercancel', onUp)
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('dblclick', onDbl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleFloor = (svgLayer: string) => {
    const next = new Set(floors)
    if (next.has(svgLayer)) next.delete(svgLayer)
    else next.add(svgLayer)
    setFloors(next)
  }

  const onMarkerClick = (m: ViewMarker, e: React.MouseEvent) => {
    e.stopPropagation()
    const wrap = wrapRef.current
    if (!wrap) return
    const r = wrap.getBoundingClientRect()
    setPop({ m, left: e.clientX - r.left, top: e.clientY - r.top })
  }

  return (
    <div className="mapview-shell">
      {meta.layers.length > 0 && (
        <div className="mapview-floors" role="group" aria-label="층 표시">
          {meta.layers.map((l) => (
            <button
              key={l.svgLayer}
              className={floors.has(l.svgLayer) ? 'active' : ''}
              onClick={() => toggleFloor(l.svgLayer)}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
      <div className="mapview" ref={wrapRef} role="application" aria-label="맵 뷰어">
        <div
          className="mapview-layer"
          ref={layerRef}
          style={{ width: proj.rect.w, height: proj.rect.h }}
        >
          <div className="mapview-svg" ref={svgHostRef} aria-hidden />
          {svgState === 'ready' &&
            markers.map((m) => {
              const { px, py } = proj.project(m.x, m.z)
              return (
                <button
                  key={m.key}
                  className="mapmark"
                  style={{
                    left: px - proj.rect.minX,
                    top: py - proj.rect.minY,
                    borderColor: m.color,
                  }}
                  onClick={(e) => onMarkerClick(m, e)}
                  aria-label={`${m.questName}: ${m.desc}`}
                >
                  <span aria-hidden>{m.icon}</span>
                </button>
              )
            })}
        </div>
        {svgState === 'loading' && <p className="mapview-note dim">지도 불러오는 중…</p>}
        {svgState === 'error' && (
          <p className="mapview-note status error">지도 로드 실패 — 새로고침 후 다시 시도</p>
        )}
        {pop && (
          <div
            className="mapmark-pop"
            style={{
              left: Math.min(pop.left, (wrapRef.current?.clientWidth ?? 320) - 240),
              top: Math.max(8, pop.top - 12),
            }}
            role="dialog"
          >
            <p className="mapmark-pop-quest">
              <span className="mapmark-dot" style={{ background: pop.m.color }} />
              {pop.m.questName}
            </p>
            <p className="mapmark-pop-desc">
              {pop.m.icon} {pop.m.desc}
            </p>
            {pop.m.keys && pop.m.keys.length > 0 && (
              <div className="mapmark-pop-keys">
                <span className="mapmark-keys-label">🔑 필요 열쇠</span>
                <span className="mapmark-keys-groups">
                  {pop.m.keys.map((group, gi) => (
                    <span key={gi} className="mapmark-key-group">
                      {gi > 0 && (
                        <span className="mapmark-key-and" title="모두 필요">
                          +
                        </span>
                      )}
                      {group.map((k, ki) => (
                        <span key={k.id} className="mapmark-key-wrap">
                          {ki > 0 && <span className="mapmark-key-or">또는</span>}
                          <button
                            className="mapmark-key"
                            onClick={() => onItem?.(k.search)}
                            title={`${k.label} — 아이템 검색(시세·구매처)`}
                          >
                            {k.iconLink && <img src={k.iconLink} alt="" loading="lazy" />}
                            <span>{k.label}</span>
                          </button>
                        </span>
                      ))}
                    </span>
                  ))}
                </span>
              </div>
            )}
            <button className="mapmark-pop-close" onClick={() => setPop(null)} aria-label="닫기">
              ×
            </button>
          </div>
        )}
        <button className="mapview-fit btn-ext" onClick={fitView}>
          ⛶ 전체
        </button>
      </div>
      <p className="hint mapview-credit">
        지도:{' '}
        <a
          className="source-link"
          href="https://github.com/the-hideout/tarkov-dev-svg-maps"
          target="_blank"
          rel="noreferrer"
        >
          The Hideout 커뮤니티 (CC BY-NC-SA 4.0) ↗
        </a>{' '}
        · 드래그 이동 · 휠/핀치 줌 · 더블클릭(탭) 확대 · 마커를 누르면 퀘스트 정보
      </p>
    </div>
  )
}
