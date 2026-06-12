// UI 스크린샷 일괄 촬영 — 디자인 변경 후 자가 점검용.
// 사용: npm run preview 띄운 뒤 node scripts/shoot-ui.mjs → .shots/ 에 PNG 저장
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

async function clickTab(label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.tabs button')].find((b) =>
      b.textContent.includes(l),
    )
    btn?.click()
  }, label)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function shoot(name) {
  await page.screenshot({ path: `.shots/${name}.png` })
  console.log(`📸 ${name}`)
}

// --- 데스크톱 1280×900 ---
await page.setViewport({ width: 1280, height: 900 })
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })
await wait(2500)
await shoot('briefing')

await clickTab('맵')
await page.waitForSelector('.map-card', { timeout: 30_000 })
await wait(1500)
await shoot('maps')

await clickTab('퀘스트')
await page.waitForSelector('.quest-row', { timeout: 300_000 })
await wait(800)
await shoot('quests-list')

await page.evaluate(() => document.querySelector('.quest-row')?.click())
await page.waitForSelector('.quest-back', { timeout: 30_000 })
await wait(800)
await shoot('quest-detail')

await clickTab('가성비')
await page.waitForSelector('.data-table', { timeout: 60_000 })
await wait(600)
await shoot('value')

// --- 모바일 390×844 ---
await page.setViewport({ width: 390, height: 844 })
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })
await wait(2000)
await shoot('m-briefing')

await clickTab('맵')
await page.waitForSelector('.map-card', { timeout: 30_000 })
await wait(1200)
await shoot('m-maps')

await browser.close()
