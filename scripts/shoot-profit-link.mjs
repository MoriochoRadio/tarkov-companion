// Phase 41 검증 — 필요템 → 돈벌이(제작·바터) 딥링크.
// 통합 체크리스트의 "🔁 제작·바터" → 돈벌이 "이 아이템 만들기/바꾸기" 필터 뷰.
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
const click = (s, t) =>
  page.evaluate(
    (s, t) => {
      ;[...document.querySelectorAll(s)].find((b) => b.textContent.includes(t))?.click()
    },
    s,
    t,
  )
const activeSub = () =>
  page.evaluate(
    () => document.querySelector('.sub-tabs button.active')?.textContent?.trim() ?? '',
  )

async function run(label, w, h) {
  await page.setViewport({ width: w, height: h })
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })
  await wait(2500)
  await click('.group-tabs button', '퀘스트 도구')
  await wait(400)
  await click('.sub-tabs button', '내 진행')
  await page.waitForSelector('.prep-row', { timeout: 60_000 })
  await wait(500)

  // "🔁 제작·바터" 링크가 있는 행을 펼친다 (제작/바터로 나오는 아이템만 노출)
  const n = await page.evaluate(() => document.querySelectorAll('.prep-row').length)
  let craftItem = null
  for (let i = 0; i < Math.min(n, 40) && !craftItem; i++) {
    await page.evaluate((idx) => {
      document.querySelectorAll('.prep-row')[idx]?.querySelector('.prep-main')?.click()
    }, i)
    await wait(150)
    craftItem = await page.evaluate(() => {
      const act = [...document.querySelectorAll('.prep-act')].find((b) =>
        b.textContent.includes('제작·바터'),
      )
      if (!act) return null
      return act.closest('.prep-row')?.querySelector('.prep-title')?.textContent ?? '?'
    })
  }
  console.log(`[${label}] 제작·바터 링크 있는 아이템: ${craftItem ? `"${craftItem}"` : '못 찾음'}`)
  await shoot(`${label}-profit-link-row`)

  // 클릭 → 돈벌이 탭 "이 아이템 만들기/바꾸기" 필터 뷰
  await page.evaluate(() =>
    [...document.querySelectorAll('.prep-act')]
      .find((b) => b.textContent.includes('제작·바터'))
      ?.click(),
  )
  await wait(700)
  const view = await page.evaluate(() => {
    const back = [...document.querySelectorAll('.quest-back')].some((b) =>
      b.textContent.includes('전체 돈벌이'),
    )
    const heads = [...document.querySelectorAll('.profit-out-h')].map((h) =>
      h.textContent.trim(),
    )
    const recipes = document.querySelectorAll('.profit-row').length
    const banner = document.querySelector('.hint')?.textContent?.includes('만들기/바꾸기')
    return { back, heads, recipes, banner }
  })
  const sub = await activeSub()
  console.log(
    `[${label}] 점프 → 서브탭:"${sub}" · 필터뷰배너:${view.banner} · 뒤로버튼:${view.back} · 구역:${JSON.stringify(view.heads)} · 레시피:${view.recipes}`,
  )
  await shoot(`${label}-profit-link-view`)

  // "전체 돈벌이 보기"로 복귀
  await page.evaluate(() =>
    [...document.querySelectorAll('.quest-back')]
      .find((b) => b.textContent.includes('전체 돈벌이'))
      ?.click(),
  )
  await wait(400)
  const restored = await page.evaluate(() => !!document.querySelector('.mode-seg'))
  console.log(`[${label}] 전체 보기 복귀 — 모드 탭 복원:${restored}`)
}

await run('desktop', 1280, 900)
await run('m', 375, 812)

await browser.close()
console.log('완료')
