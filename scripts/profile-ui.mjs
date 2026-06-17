// 퀘스트 탭 성능 실측: 프로덕션 빌드 + CPU 4x 스로틀 + V8 샘플링 프로파일러
// 사용: node scripts/profile-ui.mjs [URL] [--no-profile] — 기본 URL은 vite preview
// CLAUDE.md 규칙: UI 변경은 프로덕션 빌드 + CPU 4x 스로틀로 이 스크립트를 돌려 확인할 것
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:4173/tarkov-companion/"
const withProfile = !process.argv.includes('--no-profile')

// --use-gl=angle: 헤드리스에서도 WebGL 활성화 — 3D 위젯이 도는 실제 조건으로 측정
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle'],
})
const page = await browser.newPage()
const cdp = await page.createCDPSession()
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

// 메인 스레드 블로킹(50ms+) 추적
await page.evaluateOnNewDocument(() => {
  window.__longTasks = []
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__longTasks.push(Math.round(e.duration))
    }
  }).observe({ entryTypes: ['longtask'] })
  // 히어로 인트로(첫 방문 전용)가 탭 조작을 가로막지 않게 방문 처리
  // 히어로 자체 성능은 scripts/profile-hero.mjs로 따로 측정
  try {
    localStorage.setItem('tc:visited', '1')
  } catch {}
})

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })

if (withProfile) {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
  await cdp.send('Profiler.start')
}

// Phase 23 그룹 내비: 그룹 탭 클릭 → (서브 탭이 있으면) 서브 탭 클릭.
// 그룹 전환은 View Transition이라 서브 탭 등장이 비동기 — waitForFunction 필수
async function clickGroup(text) {
  await page.evaluate((t) => {
    ;[...document.querySelectorAll('.group-tabs button')]
      .find((b) => b.textContent.includes(t))
      .click()
  }, text)
}

async function clickTab(groupText, subText) {
  await clickGroup(groupText)
  if (!subText) return
  await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('.sub-tabs button')].some((b) =>
        b.textContent.includes(t),
      ),
    {},
    subText,
  )
  await page.evaluate((t) => {
    ;[...document.querySelectorAll('.sub-tabs button')]
      .find((b) => b.textContent.includes(t))
      .click()
  }, subText)
}

async function measure(label, action, waitSelector) {
  const t0 = Date.now()
  await action()
  await page.waitForSelector(waitSelector, { timeout: 300_000 })
  // 셀렉터 등장 후에도 메인 스레드가 잠겨 있을 수 있으니 rAF 왕복으로 인터랙티브 시점 측정
  const block = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const s = performance.now()
        requestAnimationFrame(() => resolve(Math.round(performance.now() - s)))
      }),
  )
  console.log(`${label}: ${Date.now() - t0}ms (rAF 응답 ${block}ms)`)
}

await measure(
  '1) 퀘스트 그룹 진입 → 목록 표시',
  () => clickGroup('퀘스트 도구'),
  '.quest-row',
)

await measure(
  '2) 행 클릭 → 상세 표시',
  () => page.evaluate(() => document.querySelector('.quest-row').click()),
  '.quest-back',
)

await measure(
  '3) 목록 복귀',
  () => page.evaluate(() => document.querySelector('.quest-back').click()),
  '.quest-row',
)

// 검색 타이핑 (한 글자씩)
const t0 = Date.now()
await page.type('.search-input', 'gun', { delay: 30 })
await new Promise((r) => setTimeout(r, 300))
console.log(`4) 검색 'gun' 타이핑+반영: ${Date.now() - t0}ms`)

// 필터 변경
const t1 = Date.now()
await page.evaluate(() => {
  const sel = document.querySelectorAll('.toolbar select')[0]
  sel.value = sel.options[1].value
  sel.dispatchEvent(new Event('change', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 200))
console.log(`5) 트레이더 필터 변경: ${Date.now() - t1}ms`)

// --- Phase 21: 스토리라인 모드 ---

await measure(
  '5.5) 퀘스트 스토리라인 모드 → 챕터 카드',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.mode-seg button')]
        .find((b) => b.textContent.includes('스토리라인'))
        .click(),
    ),
  '.story-card',
)

await measure(
  '5.6) 챕터 상세 진입 (목표 한국어 + 공략)',
  () => page.evaluate(() => document.querySelector('.story-foot .quest-link').click()),
  '.story-objectives',
)

// --- Phase 28: FIR 통합 운영 페이지 (2분할 + 정크박스 그리드) ---

await measure(
  '6) FIR 탭 진입 → 운영 페이지 (좌 퀘스트 아코디언 + 우 정크박스)',
  () => clickTab('퀘스트 도구', 'FIR'),
  '.fir-q-row',
)

// 무거운 상인(래그맨 — 피규어 등 아이템 많은 퀘스트) 전환 = 아코디언 최대 부하
const t6a = Date.now()
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.tk-trader')].find((x) =>
    x.textContent.includes('래그맨'),
  )
  b?.click()
})
const heavyRaf = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const s = performance.now()
      requestAnimationFrame(() => resolve(Math.round(performance.now() - s)))
    }),
)
console.log(`6.1) 무거운 상인(래그맨) 선택: ${Date.now() - t6a}ms (rAF 응답 ${heavyRaf}ms)`)

const t2 = Date.now()
await page.evaluate(() => document.querySelector('.fir-done-btn')?.click())
await new Promise((r) => setTimeout(r, 200))
console.log(`7) 좌측 퀘스트 '클리어함' → 우측 수요 차감: ${Date.now() - t2}ms`)

const t2b = Date.now()
await page.evaluate(() =>
  document
    .querySelector('.fir-tile .fir-stepper .fir-step:last-child:not(:disabled)')
    ?.click(),
)
await new Promise((r) => setTimeout(r, 200))
console.log(`7.1) 우측 스테퍼 +1 반영: ${Date.now() - t2b}ms`)

// 정렬 안정성 검증 (Phase 27 버그수정): 스테퍼 조작 후 타일 순서가 불변이어야 함
const orderBefore = await page.evaluate(() =>
  [...document.querySelectorAll('.fir-tile-name')].map((e) => e.textContent),
)
await page.evaluate(() => {
  const t = document.querySelectorAll('.fir-tile')[2] // 첫 타일이 아닌 것을 조작
  t?.querySelector('.fir-stepper .fir-step:last-child:not(:disabled)')?.click()
  t?.querySelector('.fir-stepper .fir-step:first-child:not(:disabled)')?.click()
})
await new Promise((r) => setTimeout(r, 150))
const orderAfter = await page.evaluate(() =>
  [...document.querySelectorAll('.fir-tile-name')].map((e) => e.textContent),
)
const stable = JSON.stringify(orderBefore) === JSON.stringify(orderAfter)
console.log(
  `7.12) 스테퍼 조작 후 타일 순서: ${stable ? 'OK (위치 유지)' : 'FAIL — 재정렬됨!'}`,
)

await measure(
  "7.15) 분류 전환 → '기타' (가장 큰 그리드, 2단계 렌더)",
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.fir-cat-seg button')]
        .find((b) => b.textContent.includes('기타'))
        .click(),
    ),
  '.fir-tile',
)

// 좌측 퀘스트 아이템 스테퍼 → 우측 그리드 동기화(같은 저장소) 확인
const qGotBefore = await page.evaluate(
  () => document.querySelector('.fir-q-got')?.textContent,
)
const t2c = Date.now()
await page.evaluate(() =>
  document.querySelector('.fir-q-step .fir-step-sm:last-child')?.click(),
)
await new Promise((r) => setTimeout(r, 150))
const qGotAfter = await page.evaluate(
  () => document.querySelector('.fir-q-got')?.textContent,
)
console.log(
  `7.13) 퀘스트 아이템 스테퍼 +1: ${Date.now() - t2c}ms (보유 ${qGotBefore}→${qGotAfter})`,
)

await measure(
  '7.2) 좌측 소스 → 하이드아웃 행',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.fir-side-seg button')]
        .find((b) => b.textContent.includes('하이드아웃'))
        .click(),
    ),
  '.fir-src-row',
)

await measure(
  '7.22) 스테이션 펼침 → 레벨별 요구 아이템 상세',
  () => page.evaluate(() => document.querySelector('.fir-station-toggle')?.click()),
  '.fir-level',
)

const t24a = Date.now()
await page.evaluate(() => document.querySelector('.fir-done-btn')?.click())
await new Promise((r) => setTimeout(r, 200))
console.log(`7.25) 스테이션 '건축 완료' 캐스케이드 반영: ${Date.now() - t24a}ms`)

// --- 보조 보기 (기능 삭제 없이 흡수) ---

await measure(
  '7.3) 보조 보기 → 준비물 목록 (체크리스트)',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.mode-seg button')]
        .find((b) => b.textContent.includes('준비물 목록'))
        .click(),
    ),
  '.prep-row',
)

await measure(
  '7.36) 보조 보기 → 트래커·조직도 (정크박스)',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.mode-seg button')]
        .find((b) => b.textContent.includes('트래커·조직도'))
        .click(),
    ),
  '.junk-tile',
)

await measure(
  '7.37) 트래커 → 은신처 의존성 조직도',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.fir-tab-tracker .mode-seg button, .mode-seg button')]
        .find((b) => b.textContent.trim() === '은신처 (조직도)')
        .click(),
    ),
  '.htree-node',
)

// --- Phase 25: 맵 퀘스트 플래너 ---

await measure(
  '7.39) 플래너 진입 → 맵 칩',
  () => clickTab('퀘스트 도구', '플래너'),
  '.planner-map',
)

await measure(
  '7.40) 맵 선택(세관) → 퀘스트 목록 + 가방 패널',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.planner-map')]
        .find((b) => b.textContent.includes('세관'))
        .click(),
    ),
  '.planner-quest',
)

const t25 = Date.now()
await page.evaluate(() =>
  document.querySelector('.planner-pick input').click(),
)
await new Promise((r) => setTimeout(r, 200))
console.log(`7.41) 퀘스트 체크 → 가방 합산 반영: ${Date.now() - t25}ms`)

// --- Phase 26: 맵 뷰어 ---

await measure(
  '7.42) 맵 보기 토글 → SVG 지도 로드 (lazy)',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent.includes('맵 보기'))
        .click(),
    ),
  '.mapview-svg svg',
)

// 줌 연사 — transform만 갱신되는지 (메인 스레드 응답 확인)
const t26 = Date.now()
await page.evaluate(() => {
  const mv = document.querySelector('.mapview')
  const r = mv.getBoundingClientRect()
  for (let i = 0; i < 20; i++) {
    mv.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -40,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    )
  }
})
const zoomRaf = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const s = performance.now()
      requestAnimationFrame(() => resolve(Math.round(performance.now() - s)))
    }),
)
console.log(`7.43) 휠 줌 20회 연사: ${Date.now() - t26}ms (rAF 응답 ${zoomRaf}ms)`)

// 줌 정지 → commit(벡터 재래스터) 메인스레드 블로킹 (CLAUDE.md: 1초 금지)
await new Promise((r) => setTimeout(r, 260)) // 디바운스(150ms) 후 commit 발생
const commitRaf = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const s = performance.now()
      requestAnimationFrame(() => resolve(Math.round(performance.now() - s)))
    }),
)
const commitW = await page.evaluate(() => document.querySelector('.mapview-layer')?.style.width)
console.log(`7.44) 세관 줌 정지 commit(재래스터): rAF ${commitRaf}ms · layer ${commitW}`)

// Phase 34: 마커 클릭 자동확대(rAF transform) — 메인스레드 블로킹 없는지.
// 좌표 있는 마커 확보를 위해 퀘스트 여러 개 체크 (첫 1개만으론 좌표 없을 수 있음)
await page.evaluate(() =>
  [...document.querySelectorAll('.planner-pick input')]
    .slice(0, 10)
    .forEach((i) => {
      if (!i.checked) i.click()
    }),
)
await new Promise((r) => setTimeout(r, 300))
const hasMark = await page.evaluate(() => !!document.querySelector('.mapmark'))
if (hasMark) {
  const t34 = Date.now()
  await page.evaluate(() => document.querySelector('.mapmark')?.click())
  const focusRaf = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const s = performance.now()
        requestAnimationFrame(() => resolve(Math.round(performance.now() - s)))
      }),
  )
  const clickMs = Date.now() - t34
  await new Promise((r) => setTimeout(r, 600)) // 애니(380ms)+commit 정착 대기
  console.log(`7.44b) 마커 클릭 자동확대: ${clickMs}ms (rAF 응답 ${focusRaf}ms · 이후 애니는 rAF transform)`)
} else {
  console.log('7.44b) 마커 없음(좌표 미제공 퀘스트) — 자동확대 측정 skip')
}

// 큰 SVG(해안선 304K) 고배율 재래스터 비용 — 최악 케이스
await page.evaluate(() =>
  [...document.querySelectorAll('.planner-map')]
    .find((b) => b.textContent.includes('해안선'))
    ?.click(),
)
await page.waitForSelector('.mapview-svg svg', { timeout: 30_000 })
await new Promise((r) => setTimeout(r, 900))
await page.evaluate(() => {
  const mv = document.querySelector('.mapview')
  const r = mv.getBoundingClientRect()
  for (let i = 0; i < 24; i++) {
    mv.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -60,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    )
  }
})
await new Promise((r) => setTimeout(r, 280))
const bigRaf = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const s = performance.now()
      requestAnimationFrame(() => resolve(Math.round(performance.now() - s)))
    }),
)
const bigW = await page.evaluate(() => document.querySelector('.mapview-layer')?.style.width)
console.log(`7.45) 해안선(304K) 고배율 commit 재래스터: rAF ${bigRaf}ms · layer ${bigW}`)

// --- Phase 23: 해금 탭 ---

await measure(
  '7.4) 해금 탭 진입 → 아이템 타일 그리드',
  () => clickTab('퀘스트 도구', '해금'),
  '.unlock-card',
)

await measure(
  '7.45) 해금 아이템 클릭 → 선행 체인',
  () => page.evaluate(() => document.querySelector('.unlock-card').click()),
  '.unlock-chain-list',
)

await measure(
  '7.46) 체인 퀘스트 클릭 → 퀘스트 상세로 점프',
  () => page.evaluate(() => document.querySelector('.unlock-chain-list .quest-link').click()),
  '.quest-hero',
)

await measure(
  '7.5) 돈벌이 탭 진입 → 수익 랭킹',
  () => clickTab('시세 도구', '돈벌이'),
  '.profit-row',
)

await measure(
  '8) 모딩 탭 진입 → 추천 빌드 카드',
  () => clickGroup('모딩'),
  '.build-card',
)

await measure(
  '9) 빌드 카드 펼치기 → 부품 상세',
  () => page.evaluate(() => document.querySelector('.build-head').click()),
  '.build-detail',
)

await measure(
  '10) "부품 직접 탐색" 토글 → 무기 목록',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.mode-seg button')].at(-1).click(),
    ),
  '.weapon-card',
)

await measure(
  '11) 무기 선택 → 슬롯 목록 (lazy 조회)',
  () => page.evaluate(() => document.querySelector('.weapon-card').click()),
  '.mod-slot',
)

await measure(
  '12) 슬롯 펼치기 → 부품 행',
  () => page.evaluate(() => document.querySelector('.mod-slot summary').click()),
  '.mod-part',
)

if (withProfile) {
  const { profile } = await cdp.send('Profiler.stop')
  const nodesById = new Map(profile.nodes.map((n) => [n.id, n]))
  const selfTime = new Map()
  profile.samples?.forEach((id, i) => {
    selfTime.set(id, (selfTime.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0))
  })
  const agg = new Map()
  for (const [id, t] of selfTime) {
    const n = nodesById.get(id)
    const f = n.callFrame
    const file = f.url ? f.url.split('/').pop() : ''
    const name = `${f.functionName || '(anonymous)'} @ ${file}:${f.lineNumber + 1}`
    agg.set(name, (agg.get(name) ?? 0) + t)
  }
  console.log('--- V8 self time 상위 12 ---')
  ;[...agg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .forEach(([k, v]) => console.log(`${Math.round(v / 1000)}ms  ${k}`))
}

const longTasks = await page.evaluate(() => window.__longTasks)
console.log(
  `long tasks(50ms+): ${longTasks.length}건`,
  longTasks.length ? `[${longTasks.join(', ')}]ms` : '',
)
await browser.close()
