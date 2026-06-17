// Phase 36 검증 — 통합 필요템 리스트 딥링크: 시세(검색)·출처 퀘스트(상세).
// 사용: npm run preview 띄운 뒤 node scripts/shoot-prep-links.mjs
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
const clickByText = (sel, t) =>
  page.evaluate(
    (s, l) => {
      ;[...document.querySelectorAll(s)].find((b) => b.textContent.includes(l))?.click()
    },
    sel,
    t,
  )
const activeSub = () =>
  page.evaluate(
    () => document.querySelector('.sub-tabs button.active')?.textContent?.trim() ?? '',
  )

async function gotoPrep() {
  await clickGroup('퀘스트 도구')
  await page.waitForSelector('.sub-tabs button', { timeout: 30_000 })
  await wait(400)
  await clickByText('.sub-tabs button', '내 진행')
  // '내 진행'의 기본 전면이 통합 체크리스트 → 데이터 로드(~7초) 후 바로 .prep-row
  await page.waitForSelector('.prep-row', { timeout: 60_000 })
  await wait(400)
}

// 단일 펼침(expandedId)이라 한 번에 한 행만 열린다 → 행을 하나씩 열고
// React 렌더(await)를 기다린 뒤 .prep-need-link(퀘스트 출처)가 있는 행을 찾는다
async function expandQuestRow() {
  const n = await page.evaluate(() => document.querySelectorAll('.prep-row').length)
  for (let i = 0; i < Math.min(n, 14); i++) {
    await page.evaluate((idx) => {
      document.querySelectorAll('.prep-row')[idx]?.querySelector('.prep-main')?.click()
    }, i)
    await wait(180)
    if (await page.evaluate(() => !!document.querySelector('.prep-need-link'))) return true
  }
  return false
}

async function run(label, w, h) {
  await page.setViewport({ width: w, height: h })
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })
  await wait(2500)
  await gotoPrep()

  const found = await expandQuestRow()
  const has = await page.evaluate(() => ({
    act: !!document.querySelector('.prep-act'),
    questLink: !!document.querySelector('.prep-need-link'),
  }))
  console.log(`[${label}] 펼침 — 시세버튼:${has.act} 퀘스트링크:${has.questLink} (questRow:${found})`)
  await shoot(`${label}-prep-links`)

  // 퀘스트 출처 클릭 → 퀘스트 탭 상세로 점프
  await page.evaluate(() => document.querySelector('.prep-need-link')?.click())
  await wait(600)
  const afterQuest = await activeSub()
  const questDetail = await page.evaluate(() => !!document.querySelector('.quest-back'))
  console.log(`[${label}] 퀘스트 출처 클릭 → 활성 서브탭: "${afterQuest}" · 상세열림:${questDetail}`)

  // 다시 준비물로 → 시세 버튼 → 검색 탭으로 점프
  await gotoPrep()
  await expandQuestRow()
  await page.evaluate(() => document.querySelector('.prep-act')?.click())
  await wait(600)
  const afterItem = await activeSub()
  const searchInput = await page.evaluate(() => !!document.querySelector('.search-input'))
  console.log(`[${label}] 🔍 시세 클릭 → 활성 서브탭: "${afterItem}" · 검색창:${searchInput}`)
}

await run('desktop', 1280, 900)
await run('m', 375, 812)

await browser.close()
console.log('완료')
