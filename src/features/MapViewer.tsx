import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
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
  questId: string // 포커스 모드(같은 퀘스트 강조)·표시 토글 식별용 (Phase 34)
  num: number // 퀘스트 선택 번호(1,2,3…) — 색맹 대응, 좌측 목록과 색 없이 매칭
  x: number
  z: number
  icon: string // 6분류 이모지 (플래너와 공유)
  color: string // 퀘스트별 색
  questName: string
  desc: string
  // 잠긴 목표의 필요 열쇠 — [[Key]] 그룹 배열(그룹 간 AND, 그룹 내 OR). 없으면 숨김
  keys?: MarkerKey[][]
  // 출처 링크 (Phase 34) — 위키 위치 사진 재호스팅 대신 정확한 위치는 링크로만 안내.
  // PlannerTab이 실어 보냄 (MapViewer는 quests API를 모름)
  wikiLink?: string | null
  mapNormalizedName?: string | null
}

// 좌측 리스트 호버 → 그 퀘스트 마커만 또렷(포커스 모드, Phase 34)을 명령형으로 제어.
// state를 안 쓰는 이유: 호버마다 리렌더하면 마커 20+개를 다시 그려 성능 규칙(1초)에 위험.
export interface MapViewerHandle {
  focusQuest: (questId: string | null) => void
}

// 탈출구 마커 (Phase 35) — 퀘스트 마커와 별도 레이어. focus/숨김/완료 로직과 분리해
// 기존 퀘스트 마커 코드를 건드리지 않는다. 좌표는 퀘스트 목표와 동일 게임 월드(x,z).
export type ExtractFaction = 'pmc' | 'scav' | 'shared'
export interface ExtractMarker {
  key: string
  x: number
  z: number
  name: string
  faction: ExtractFaction
}

// 진영 라벨 — 범례·팝오버 공용. 색은 CSS(.mapextract.f-*)에서 (퀘스트 8색과 톤 구분)
export const FACTION_LABEL: Record<ExtractFaction, string> = {
  pmc: 'PMC',
  scav: '스캐브',
  shared: '공용',
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

export const MapViewer = forwardRef<
  MapViewerHandle,
  {
    meta: MapMeta
    svgUrl: string
    markers: ViewMarker[]
    extracts?: ExtractMarker[] // 탈출구 마커 (Phase 35) — 켰을 때만 전달
    doneKeys?: ReadonlySet<string> // 완료/방문 표시된 목표-위치 키 (Phase 34)
    onItem?: (name: string) => void // 열쇠 클릭 → 아이템 검색으로 이동
    onToggleDone?: (key: string) => void // 팝오버 "완료" 토글
  }
>(function MapViewer(
  { meta, svgUrl, markers, extracts, doneKeys, onItem, onToggleDone },
  ref,
) {
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
  // 강조 링을 띄울 마커 키 — 클릭한 위치에 "여기"를 표시 (Phase 34, 줌은 Phase 37에서 제거)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // 탈출구 팝오버 (Phase 35) — 퀘스트 팝오버(pop)와 분리. 이름+진영만 간단히
  const [extractPop, setExtractPop] = useState<{
    e: ExtractMarker
    left: number
    top: number
  } | null>(null)

  // 팝오버를 Esc로 닫기 (마커·탈출구 각각)
  useEscapeKey(!!pop, () => setPop(null))
  useEscapeKey(!!extractPop, () => setExtractPop(null))

  const proj = useMemo(() => makeProjector(meta), [meta])

  // --- 줌 화질: "보여주기 배율(view.s)"과 "SVG에 실제 반영된 배율(baseScale)" 분리 ---
  // SVG는 will-change/transform 합성 레이어라 기본 크기로 한 번 비트맵으로 굽고 확대 시
  // 그 텍스처만 늘린다 → 벡터인데도 고배율에서 뭉개짐. 줌이 멈추면 그 배율을 SVG 실제
  // 렌더 크기(레이어 px)에 반영해 브라우저가 벡터를 그 해상도로 다시 그리게 한다.
  // 제스처 중에는 transform scale(s/baseScale)로 차이만 compositor가 확대(부드러움 유지).
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  // 재래스터 텍스처 메모리 상한(~96MB) — 이 이상 필요한 배율은 compositor scale로 폴백.
  // rect이 작아(최대 ~345px) 대부분 맵은 최대 줌까지 상한에 안 걸려 완전히 또렷.
  const baseScaleCap = useMemo(() => {
    const texPx = proj.rect.w * proj.rect.h * dpr * dpr
    return texPx > 0 ? Math.max(1, Math.sqrt(24_000_000 / texPx)) : ZOOM_MAX
  }, [proj, dpr])

  const [baseScale, setBaseScale] = useState(1)
  const baseRef = useRef(1)
  const commitTimer = useRef<number | null>(null)

  // --- 팬·줌 상태: ref + 직접 스타일 갱신 (리렌더 금지) ---
  const view = useRef({ x: 0, y: 0, s: 1, fit: 1 })
  const apply = () => {
    const l = layerRef.current
    if (!l) return
    const v = view.current
    const b = baseRef.current
    // 레이어는 rect*baseScale px 크기 → 거기서 차이(s/baseScale)만 합성 확대
    l.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s / b})`
    l.style.setProperty('--inv', String(b / v.s))
  }

  // 줌 정지(디바운스) → 현재 배율을 SVG 실제 해상도에 반영(벡터 재래스터). 팬은 트리거 안 함
  const commit = () => {
    const target = Math.min(view.current.s, baseScaleCap)
    if (Math.abs(target - baseRef.current) / baseRef.current > 0.05) {
      baseRef.current = target
      setBaseScale(target) // 레이어 크기·마커 위치 재계산 → useLayoutEffect에서 transform 동기
    }
  }
  const scheduleCommit = () => {
    if (commitTimer.current != null) clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(commit, 150)
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
    setExtractPop(null)
    apply()
    scheduleCommit()
  }

  const fitView = () => {
    const wrap = wrapRef.current
    if (!wrap) return
    setFocusKey(null)
    const cw = wrap.clientWidth
    const ch = wrap.clientHeight
    const s = Math.min(cw / proj.rect.w, ch / proj.rect.h) * 0.96
    view.current = {
      x: (cw - proj.rect.w * s) / 2,
      y: (ch - proj.rect.h * s) / 2,
      s,
      fit: s,
    }
    // 초기/리사이즈는 즉시 그 배율로 재래스터 (디바운스 없이 또렷하게 시작)
    baseRef.current = Math.min(s, baseScaleCap)
    setBaseScale(baseRef.current)
    apply()
  }

  // 좌측 리스트 호버 → 그 퀘스트 마커만 또렷(나머지 흐리게). 리렌더 없이 DOM 클래스만 토글.
  useImperativeHandle(ref, () => ({
    focusQuest: (questId: string | null) => {
      const layer = layerRef.current
      if (!layer) return
      for (const n of layer.querySelectorAll<HTMLElement>('.mapmark')) {
        if (questId == null) n.classList.remove('dimmed')
        else n.classList.toggle('dimmed', n.dataset.quest !== questId)
      }
    },
  }), [])

  // baseScale 변경(commit) → baseRef 동기 + transform 재적용. 레이어 크기·마커는 이미
  // 새 baseScale로 렌더됐고, 같은 페인트 전에 transform을 맞춰 재래스터 전후 튐 없음
  useLayoutEffect(() => {
    baseRef.current = baseScale
    apply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseScale])

  // 언마운트 시 디바운스 타이머 정리
  useEffect(() => () => {
    if (commitTimer.current != null) clearTimeout(commitTimer.current)
  }, [])

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
      if (
        (e.target as Element).closest?.(
          '.mapmark, .mapmark-pop, .mapextract, .mapextract-pop, .mapview-fit',
        )
      ) {
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
        if (moved) {
          setPop(null)
          setExtractPop(null)
        }
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
    setExtractPop(null)
    // 줌인 없이 — 강조 링으로 "여기"만 표시하고 팝오버는 클릭 지점 근처에 (친구 피드백:
    // 클릭마다 카메라가 확대돼 거슬림, Phase 37). 더 자세한 위치는 팝오버의 출처 링크로.
    setFocusKey(m.key)
    setPop({ m, left: e.clientX - r.left, top: e.clientY - r.top })
  }

  // 탈출구 클릭 (Phase 35) — 자동확대 없이 이름+진영만. 퀘스트 팝오버는 닫음
  const onExtractClick = (ex: ExtractMarker, e: React.MouseEvent) => {
    e.stopPropagation()
    const wrap = wrapRef.current
    if (!wrap) return
    const r = wrap.getBoundingClientRect()
    setPop(null)
    setExtractPop({ e: ex, left: e.clientX - r.left, top: e.clientY - r.top })
  }

  // 강조 링 좌표 — 포커스된 마커가 현재 표시 목록에 있을 때만
  const focused = focusKey ? markers.find((m) => m.key === focusKey) : null
  const focusedPt = focused ? proj.project(focused.x, focused.z) : null

  const popDone = pop ? doneKeys?.has(pop.m.key) ?? false : false

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
          style={{ width: proj.rect.w * baseScale, height: proj.rect.h * baseScale }}
        >
          <div className="mapview-svg" ref={svgHostRef} aria-hidden />
          {/* 탈출구 레이어 — 퀘스트 마커보다 먼저(뒤에) 그려 "지도 시설"처럼 읽히게 */}
          {svgState === 'ready' &&
            extracts?.map((ex) => {
              const { px, py } = proj.project(ex.x, ex.z)
              return (
                <button
                  key={ex.key}
                  className={`mapextract f-${ex.faction}`}
                  style={{
                    left: (px - proj.rect.minX) * baseScale,
                    top: (py - proj.rect.minY) * baseScale,
                  }}
                  onClick={(e) => onExtractClick(ex, e)}
                  title={`🚪 ${ex.name} — ${FACTION_LABEL[ex.faction]} 탈출구`}
                  aria-label={`탈출구 ${ex.name} (${FACTION_LABEL[ex.faction]})`}
                >
                  <span aria-hidden>🚪</span>
                </button>
              )
            })}
          {svgState === 'ready' &&
            markers.map((m) => {
              const { px, py } = proj.project(m.x, m.z)
              const done = doneKeys?.has(m.key)
              return (
                <button
                  key={m.key}
                  className={`mapmark${done ? ' done' : ''}`}
                  data-quest={m.questId}
                  style={{
                    left: (px - proj.rect.minX) * baseScale,
                    top: (py - proj.rect.minY) * baseScale,
                    borderColor: m.color,
                  }}
                  onClick={(e) => onMarkerClick(m, e)}
                  aria-label={`${m.num}번 ${m.questName}: ${m.desc}${done ? ' (완료 표시됨)' : ''}`}
                >
                  <span aria-hidden>{m.icon}</span>
                  {m.num > 0 && (
                    // 퀘스트 번호 배지 — 좌측 목록 점의 번호와 일치, 색 없이 식별
                    <span className="mapmark-num" aria-hidden>
                      {m.num}
                    </span>
                  )}
                  {done && (
                    <span className="mapmark-check" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          {svgState === 'ready' && focusedPt && (
            <div
              className="mapmark-focus"
              style={{
                left: (focusedPt.px - proj.rect.minX) * baseScale,
                top: (focusedPt.py - proj.rect.minY) * baseScale,
              }}
              aria-hidden
            />
          )}
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
              <span className="mapmark-dot mapmark-dot-num" style={{ background: pop.m.color }}>
                {pop.m.num > 0 ? pop.m.num : ''}
              </span>
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
            {(pop.m.wikiLink || pop.m.mapNormalizedName) && (
              <div className="mapmark-pop-src">
                {pop.m.wikiLink && (
                  <a
                    className="source-link"
                    href={pop.m.wikiLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    위키에서 정확한 위치 ↗
                  </a>
                )}
                {pop.m.mapNormalizedName && (
                  <a
                    className="source-link"
                    href={`https://tarkov.dev/map/${pop.m.mapNormalizedName}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    tarkov.dev 맵 ↗
                  </a>
                )}
              </div>
            )}
            <p className="mapmark-pop-approx">근사 위치 — 정확한 지점은 출처 링크 참고</p>
            {onToggleDone && (
              <button
                className={`mapmark-pop-done${popDone ? ' on' : ''}`}
                onClick={() => onToggleDone(pop.m.key)}
              >
                {popDone ? '✓ 완료 표시됨 — 해제' : '여기 완료·방문함'}
              </button>
            )}
            <button className="mapmark-pop-close" onClick={() => setPop(null)} aria-label="닫기">
              ×
            </button>
          </div>
        )}
        {extractPop && (
          <div
            className="mapmark-pop mapextract-pop"
            style={{
              left: Math.min(extractPop.left, (wrapRef.current?.clientWidth ?? 320) - 200),
              top: Math.max(8, extractPop.top - 12),
            }}
            role="dialog"
          >
            <p className="mapmark-pop-quest">
              <span className={`mapextract-swatch f-${extractPop.e.faction}`} />
              🚪 {extractPop.e.name}
            </p>
            <p className="mapmark-pop-desc">{FACTION_LABEL[extractPop.e.faction]} 탈출구</p>
            <button
              className="mapmark-pop-close"
              onClick={() => setExtractPop(null)}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        )}
        {svgState === 'ready' && extracts && extracts.length > 0 && (
          <div className="mapextract-legend" aria-hidden>
            <span>🚪 탈출구</span>
            <span className="mapextract-swatch f-pmc" /> PMC
            <span className="mapextract-swatch f-scav" /> 스캐브
            <span className="mapextract-swatch f-shared" /> 공용
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
        · 드래그 이동 · 휠/핀치 줌 · 마커를 누르면 위치 강조 + 퀘스트 정보
      </p>
    </div>
  )
})
