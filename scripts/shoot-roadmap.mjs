// Phase 42 검증 — 다음 퀘스트 로드맵: 상태 배지(▶/🔒) + "받을 수 있는 것만" 필터 +
// 완료를 체크할수록 받을 수 있는 퀘스트가 늘어나는지(언락). 사용: npm run preview 후 실행
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.argv[2]?.startsWith('http')
  ? process.argv[2]
  : 'http://localhost:4173/tarkov-companion/'
mkdirSync('.shots', { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle'],
})
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('tc:visited', '1')
    localStorage.removeItem('tc:done-quests') // 깨끗한 시작
  } catch {}
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const shoot = async (n) => {
  await page.screenshot({ path: `.shots/${n}.png` })
  console.log(`📸 ${n}`)
}
const click = (s, t) =>
  page.evaluate(
    (s, t) => {
      ;[...document.querySelectorAll(s)].find((b) => b.textContent.includes(t))?.click()
    },
    s,
    t,
  )
const toggleAvail = (on) =>
  page.evaluate((on) => {
    const lab = [...document.querySelectorAll('.toggle')].find((l) =>
      l.textContent.includes('받을 수 있는'),
    )
    const cb = lab?.querySelector('input')
    if (cb && cb.checked !== on) cb.click()
  }, on)
const filteredCount = () =>
  page.evaluate(() => {
    const t = [...document.querySelectorAll('.hint')]
      .map((h) => h.textContent)
      .find((x) => /개 퀘스트/.test(x || ''))
    return Number((t?.match(/(\d+)개 퀘스트/) || [])[1] || '0')
  })

async function run(label, w, h) {
  await page.setViewport({ width: w, height: h })
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })
  await wait(2500)
  await click('.group-tabs button', '퀘스트 도구')
  await wait(400)
  await click('.sub-tabs button', '퀘스트')
  await page.waitForSelector('.quest-row', { timeout: 30_000 })
  await wait(500)

  // 상태 배지 렌더 확인 (정상 모드) — 행에 한정(hint 범례 제외)
  const badges = await page.evaluate(() => ({
    avail: document.querySelectorAll('.quest-row .quest-status.avail').length,
    locked: document.querySelectorAll('.quest-row .quest-status.locked').length,
  }))
  console.log(`[${label}] 배지 — ▶받을수있음:${badges.avail} 🔒잠김:${badges.locked}`)
  await shoot(`${label}-roadmap-list`)

  // "받을 수 있는 것만" 필터 → 잠김 배지 0이어야(전부 받을 수 있음), 카운트 A
  await toggleAvail(true)
  await wait(400)
  const a = await filteredCount()
  const lockedInAvail = await page.evaluate(
    () => document.querySelectorAll('.quest-row .quest-status.locked').length,
  )
  console.log(`[${label}] 받을수있는것만 ON — ${a}개 · 그중 잠김배지:${lockedInAvail}(0이어야)`)

  // 완료를 다수 체크 → 후행 언락
  await toggleAvail(false)
  await wait(300)
  await page.evaluate(() => {
    document.querySelectorAll('.quest-row .done-btn').forEach((b, i) => {
      if (i < 60) b.click()
    })
  })
  await wait(400)
  await toggleAvail(true)
  await wait(400)
  const b2 = await filteredCount()
  console.log(
    `[${label}] 퀘스트 60개 완료 후 받을수있는것만 — ${b2}개 (이전 ${a} → 증가 ${b2 - a}) → 언락:${b2 > a}`,
  )
}

await run('desktop', 1280, 950)
await run('m', 375, 812)

await browser.close()
console.log('완료')
