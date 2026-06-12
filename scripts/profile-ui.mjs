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
  '1) 퀘스트 탭 진입 → 목록 표시',
  () =>
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('.tabs button')].find((b) =>
        b.textContent.includes('퀘스트'),
      )
      btn.click()
    }),
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
  '5.6) 챕터 목표 펼치기',
  () => page.evaluate(() => document.querySelector('.story-foot .quest-link').click()),
  '.story-objectives',
)

// --- Phase 12 추가 탭 ---

await measure(
  '6) 준비물 탭 진입 → 체크리스트 표시',
  () =>
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('.tabs button')].find((b) =>
        b.textContent.includes('준비물'),
      )
      btn.click()
    }),
  '.prep-row',
)

const t2 = Date.now()
await page.evaluate(() =>
  document.querySelector('.prep-step:not(:disabled)').click(),
)
await new Promise((r) => setTimeout(r, 200))
console.log(`7) 체크리스트 +1 반영: ${Date.now() - t2}ms`)

// --- Phase 21: 은신처 건설 순서 ---

await measure(
  '7.2) 준비물 → 은신처 뷰',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.mode-seg button')]
        .find((b) => b.textContent.includes('은신처'))
        .click(),
    ),
  '.station-grid',
)

await measure(
  '7.3) 은신처 → 건설 순서 (위상 정렬 + 아이콘 다수, 2단계 렌더)',
  () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.mode-seg button')]
        .find((b) => b.textContent.includes('건설 순서'))
        .click(),
    ),
  '.bo-step',
)

await measure(
  '7.5) 돈벌이 탭 진입 → 수익 랭킹',
  () =>
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('.tabs button')].find((b) =>
        b.textContent.includes('돈벌이'),
      )
      btn.click()
    }),
  '.profit-row',
)

await measure(
  '8) 모딩 탭 진입 → 추천 빌드 카드',
  () =>
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('.tabs button')].find((b) =>
        b.textContent.includes('모딩'),
      )
      btn.click()
    }),
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
