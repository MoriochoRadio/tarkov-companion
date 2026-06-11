// three.js 무기 뷰어 — 이 모듈은 반드시 dynamic import로만 불러올 것.
// (three ~170KB gz가 첫 페인트 번들에 섞이면 안 됨 — WeaponShowcase가 지연 로드함)
//
// 조명 컨셉: 어두운 배경 + 탄 골드 림라이트 — 사이트 무드(그래파이트+골드)와 일치
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export interface ViewerOptions {
  autoRotate: boolean
  interactive: boolean // 드래그 회전 허용
  onContextLost?: () => void
}

export interface ViewerHandle {
  loadWeapon(url: string): Promise<void>
  dispose(): void
}

const FADE_MS = 300
const TARGET_SIZE = 3.1 // 모델을 카메라 프레임에 맞추는 기준 크기

interface FadeMat {
  mat: THREE.Material & { opacity: number }
  base: number
}

function collectMats(root: THREE.Object3D): FadeMat[] {
  const list: FadeMat[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      m.transparent = true
      list.push({ mat: m as FadeMat['mat'], base: (m as FadeMat['mat']).opacity })
    }
  })
  return list
}

export function createViewer(
  canvas: HTMLCanvasElement,
  opts: ViewerOptions,
): ViewerHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true, // 배경은 페이지가 그림 (캔버스는 투명)
    antialias: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
  camera.position.set(0, 0.5, 4.4)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.AmbientLight(0xb8c0c8, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.0)
  key.position.set(2, 3, 4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xc9b482, 2.4) // 탄 골드 림
  rim.position.set(-2.5, 2.2, -3)
  scene.add(rim)
  const fill = new THREE.DirectionalLight(0x70809a, 0.35)
  fill.position.set(-3, -1.5, 2)
  scene.add(fill)

  const holder = new THREE.Group()
  holder.rotation.x = 0.12 // 살짝 내려다보는 각
  scene.add(holder)

  const loader = new GLTFLoader()
  let current: THREE.Group | null = null
  let rafId = 0
  let last = performance.now()
  let disposed = false
  let dragging = false

  // ---------- 크기 추적 ----------
  function fitSize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(fitSize)
  ro.observe(canvas)
  fitSize()

  // ---------- 렌더 루프 (탭 숨김 시 정지) ----------
  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    if (opts.autoRotate && !dragging && current) {
      holder.rotation.y += dt * 0.5 // 천천히 — 한 바퀴 ~12.5초
    }
    renderer.render(scene, camera)
    rafId = requestAnimationFrame(frame)
  }
  rafId = requestAnimationFrame(frame)

  function onVisibility() {
    if (disposed) return
    if (document.hidden) {
      cancelAnimationFrame(rafId)
    } else {
      last = performance.now()
      rafId = requestAnimationFrame(frame)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  // ---------- 드래그 회전 ----------
  let px = 0
  let py = 0
  function onDown(e: PointerEvent) {
    dragging = true
    px = e.clientX
    py = e.clientY
    canvas.setPointerCapture(e.pointerId)
    canvas.style.cursor = 'grabbing'
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return
    holder.rotation.y += (e.clientX - px) * 0.008
    holder.rotation.x = Math.max(
      -0.6,
      Math.min(0.7, holder.rotation.x + (e.clientY - py) * 0.005),
    )
    px = e.clientX
    py = e.clientY
  }
  function onUp(e: PointerEvent) {
    dragging = false
    canvas.style.cursor = 'grab'
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  }
  if (opts.interactive) {
    canvas.style.cursor = 'grab'
    canvas.style.touchAction = 'none'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
  }

  // ---------- 컨텍스트 손실 → 호출부가 포스터로 폴백 ----------
  function onLost(e: Event) {
    e.preventDefault()
    opts.onContextLost?.()
  }
  canvas.addEventListener('webglcontextlost', onLost)

  // ---------- 페이드 ----------
  function fade(mats: FadeMat[], from: number, to: number): Promise<void> {
    return new Promise((resolve) => {
      const t0 = performance.now()
      const tick = (t: number) => {
        if (disposed) return resolve()
        const p = Math.min(1, (t - t0) / FADE_MS)
        const v = from + (to - from) * p
        for (const { mat, base } of mats) mat.opacity = base * v
        if (p < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }

  function disposeModel(root: THREE.Object3D) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach((m) => m.dispose())
    })
  }

  // ---------- 모델 로드 + 전환 ----------
  async function loadWeapon(url: string) {
    const gltf = await loader.loadAsync(url)
    if (disposed) return
    const model = gltf.scene

    // 모델마다 크기/원점이 제각각 — 중심 정렬 + 프레임에 맞게 스케일
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const scale = TARGET_SIZE / Math.max(size.x, size.y, size.z, 0.001)
    model.scale.setScalar(scale)
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale)
    model.position.sub(center)

    const newMats = collectMats(model)

    if (current) {
      const oldMats = collectMats(current)
      await fade(oldMats, 1, 0) // 현재 무기 페이드아웃
      if (disposed) return
      holder.remove(current)
      disposeModel(current)
    }

    for (const { mat } of newMats) mat.opacity = 0
    holder.add(model)
    current = model
    await fade(newMats, 0, 1) // 다음 무기 페이드인
  }

  function dispose() {
    disposed = true
    cancelAnimationFrame(rafId)
    ro.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    canvas.removeEventListener('webglcontextlost', onLost)
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    if (current) disposeModel(current)
    renderer.dispose()
  }

  return { loadWeapon, dispose }
}
