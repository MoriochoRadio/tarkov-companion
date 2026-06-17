// Phase 39 검증 — 퀘스트 완료(tc:done-quests) 크로스탭 연동.
// 퀘스트 탭에서 완료 체크 → 통합 체크리스트에서 그 퀘스트 아이템 자동 제외 +
// 플래너·해금 토글. 사용: npm run preview 후 node scripts/shoot-done-quests.mjs
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
const clickGroup = (t) =>
  page.evaluate((l) => {
    ;[...document.querySelectorAll('.group-tabs button')]
      .find((b) => b.textContent.includes(l))
      ?.click()
  }, t)
const clickSub = (t) =>
  page.evaluate((l) => {
    ;[...document.querySelectorAll('.sub-tabs button')]
      .find((b) => b.textContent.includes(l))
      ?.click()
  }, t)
const setSourceQuest = () =>
  page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'quest'),
    )
    if (sel) {
      sel.value = 'quest'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })

await page.setViewport({ width: 1280, height: 950 })
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })
await wait(2500)

// --- 1) 내 진행 통합 체크리스트(퀘스트만) 기준 개수 ---
await clickGroup('퀘스트 도구')
await wait(400)
await clickSub('내 진행')
await page.waitForSelector('.prep-row', { timeout: 60_000 })
await wait(400)
await setSourceQuest()
await wait(400)
// .prep-row DOM은 visible 캡(60)에 막히므로 요약 바의 총량(needSum·종수)으로 측정
const readSummary = () =>
  page.evaluate(() => {
    const t = document.querySelector('.prep-summary')?.textContent || ''
    const need = Number((t.match(/\/([\d,]+)개/)?.[1] || '0').replace(/,/g, ''))
    const kinds = Number(t.match(/\/(\d+)종/)?.[1] || '0')
    return { need, kinds }
  })
const before = await readSummary()
console.log(`[통합 체크리스트·퀘스트만] 완료 전 — 총 필요 ${before.need}개 / ${before.kinds}종`)

// --- 2) 퀘스트 탭에서 앞쪽 퀘스트 다수 완료 체크 ---
await clickSub('퀘스트')
await page.waitForSelector('.quest-row', { timeout: 30_000 })
await wait(300)
const marked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.quest-row .done-btn')].slice(0, 40)
  btns.forEach((b) => b.click())
  return btns.length
})
await wait(300)
const stat = await page.evaluate(() => ({
  doneLS: JSON.parse(localStorage.getItem('tc:done-quests') || '[]').length,
  doneRows: document.querySelectorAll('.quest-row.done').length,
}))
console.log(`[퀘스트] 완료 클릭 ${marked}개 → LS done=${stat.doneLS} · .quest-row.done=${stat.doneRows}`)
await shoot('done-quests-list')

// --- 3) 다시 통합 체크리스트 → 그 퀘스트 아이템이 빠졌는지 ---
await clickSub('내 진행')
await page.waitForSelector('.prep-row', { timeout: 60_000 })
await wait(400)
await setSourceQuest()
await wait(400)
const after = await readSummary()
console.log(
  `[통합 체크리스트·퀘스트만] 완료 후 — 총 필요 ${after.need}개 / ${after.kinds}종 ` +
    `(감소 ${before.need - after.need}개·${before.kinds - after.kinds}종) → 제외 동작:${after.need < before.need}`,
)
await shoot('done-quests-checklist')

// --- 4) 해금 체인 완료 토글 ---
await clickSub('해금')
await page.waitForSelector('.unlock-card', { timeout: 30_000 })
await wait(300)
await page.evaluate(() => document.querySelector('.unlock-card')?.click())
await page.waitForSelector('.unlock-chain-list', { timeout: 30_000 })
await wait(300)
const unlock = await page.evaluate(() => {
  const btn = document.querySelector('.unlock-chain-list .done-btn')
  const hasBtn = !!btn
  btn?.click()
  return {
    hasBtn,
    doneLi: document.querySelectorAll('.unlock-chain-list li.done').length,
  }
})
console.log(`[해금] 체인 완료버튼:${unlock.hasBtn} · 클릭 후 li.done=${unlock.doneLi}`)

// --- 5) 플래너 퀘스트 리스트 완료 토글 ---
await clickSub('플래너')
await page.waitForSelector('.planner-map', { timeout: 30_000 })
await page.evaluate(() =>
  [...document.querySelectorAll('.planner-map')]
    .find((b) => b.textContent.includes('세관'))
    ?.click(),
)
await page.waitForSelector('.planner-quest', { timeout: 30_000 })
await wait(300)
const planner = await page.evaluate(() => {
  const btn = document.querySelector('.planner-quest .done-btn')
  const hasBtn = !!btn
  btn?.click()
  return {
    hasBtn,
    doneRows: document.querySelectorAll('.planner-quest.done').length,
  }
})
console.log(`[플래너] 퀘스트 완료버튼:${planner.hasBtn} · 클릭 후 .planner-quest.done=${planner.doneRows}`)

await browser.close()
console.log('완료')
