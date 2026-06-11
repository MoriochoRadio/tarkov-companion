// 히어로 인트로 성능 실측: 프로덕션 빌드 + CPU 4x 스로틀
// 측정: 리빌 구간 롱태스크, canvas 애니메이션 fps, 입장 전환 직후 rAF 응답
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.argv[2]?.startsWith('http')
  ? process.argv[2]
  : 'http://localhost:4173/tarkov-companion/'

// --use-gl=angle: 헤드리스에서도 WebGL 활성화 — 3D 무기 쇼케이스까지 포함해 측정
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle'],
})
const page = await browser.newPage()
const cdp = await page.createCDPSession()
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

await page.evaluateOnNewDocument(() => {
  window.__longTasks = []
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__longTasks.push(Math.round(e.duration))
    }
  }).observe({ entryTypes: ['longtask'] })
})

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })

const hasHero = await page.evaluate(() => !!document.querySelector('.hero'))
if (!hasHero) {
  console.log('히어로가 안 떴음 (visited 저장됨?) — 측정 불가')
  process.exit(1)
}

// 리빌 애니메이션이 끝날 때까지 두고 fps 측정 (3초간 rAF 횟수)
await new Promise((r) => setTimeout(r, 2200))
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0
      const t0 = performance.now()
      const tick = () => {
        frames++
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick)
        else resolve(Math.round(frames / 3))
      }
      requestAnimationFrame(tick)
    }),
)
console.log(`canvas 애니메이션 fps (4x 스로틀): ${fps}`)

// 입장 → 전환 직후 메인 스레드 응답
const t0 = Date.now()
await page.click('.hero-enter')
await page.waitForSelector('.briefing-headline, .status, .skeleton-table', {
  timeout: 30_000,
})
const block = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const s = performance.now()
      requestAnimationFrame(() => resolve(Math.round(performance.now() - s)))
    }),
)
console.log(`입장 전환: ${Date.now() - t0}ms (rAF 응답 ${block}ms)`)

const longTasks = await page.evaluate(() => window.__longTasks)
console.log(
  `long tasks(50ms+): ${longTasks.length}건`,
  longTasks.length ? `[${longTasks.join(', ')}]ms` : '',
)
await browser.close()
