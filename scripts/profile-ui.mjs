// 퀘스트 탭 성능 실측: 프로덕션 빌드 + CPU 4x 스로틀 + V8 샘플링 프로파일러
// 사용: node scripts/profile-ui.mjs [URL] [--no-profile] — 기본 URL은 vite preview
// CLAUDE.md 규칙: UI 변경은 프로덕션 빌드 + CPU 4x 스로틀로 이 스크립트를 돌려 확인할 것
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:4173/tarkov-companion/"
const withProfile = !process.argv.includes('--no-profile')

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
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
