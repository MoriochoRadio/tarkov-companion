// Phase 34 검증 — 플래너 맵 마커: 자동확대·강조 링·출처 링크·표시 토글·완료 표시.
// 사용: npm run preview 띄운 뒤 node scripts/shoot-planner-markers.mjs → .shots/ 저장
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:4173/tarkov-companion/'
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
    // 신규 키는 run마다 초기화(같은 origin이라 누적됨 — 격리)
    localStorage.removeItem('tc:planner-hidden')
    localStorage.removeItem('tc:planner-done')
    // 기존 키 보존 확인용 시드 — 검증 후 그대로 남아야 함
    localStorage.setItem('tc:planner-picks', JSON.stringify({ __seed: ['x'] }))
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

async function setup() {
  await clickGroup('퀘스트 도구')
  await page.waitForSelector('.sub-tabs button', { timeout: 30_000 })
  await wait(200)
  await clickSub('플래너')
  // 퀘스트 데이터 로드(최초 ~7초) 후 맵 칩이 뜬다
  await page.waitForSelector('.planner-map', { timeout: 60_000 })
  // 마커가 많은 맵(세관) 선택
  await page.evaluate(() =>
    [...document.querySelectorAll('.planner-map')]
      .find((b) => b.textContent.includes('세관'))
      ?.click(),
  )
  await page.waitForSelector('.planner-quest', { timeout: 30_000 })
  // 좌표 있는 퀘스트를 여러 개 체크 (마커 5개+ 확보)
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.planner-pick input')]
    inputs.slice(0, 8).forEach((i) => i.click())
  })
  await wait(200)
  // 맵 보기 켜기
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('맵 보기'))
      ?.click(),
  )
  await page.waitForSelector('.mapview-svg svg', { timeout: 30_000 })
  await wait(900)
  // 맵을 화면에 보이게 — 팝오버·강조 링이 맵 중앙이라 뷰포트로 끌어온다
  await page.evaluate(() =>
    document.querySelector('.mapview')?.scrollIntoView({ block: 'center' }),
  )
  await wait(200)
}

async function run(label, w, h) {
  await page.setViewport({ width: w, height: h })
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })
  await wait(2500)
  await setup()

  const markerCount = await page.evaluate(
    () => document.querySelectorAll('.mapmark').length,
  )
  const shownBar = await page.evaluate(
    () => document.querySelector('.planner-marker-bar')?.textContent?.trim(),
  )
  console.log(`[${label}] 마커 ${markerCount}개 · 바: "${shownBar}"`)
  await shoot(`${label}-planner-markers`)

  // ① 마커 클릭 → 자동확대 + 강조 링 + 팝오버(출처 링크·완료 버튼)
  await page.evaluate(() => document.querySelector('.mapmark')?.click())
  await wait(700) // 자동확대 애니메이션(380ms) 후
  const pop = await page.evaluate(() => {
    const hasSrc = !!document.querySelector('.mapmark-pop-src a')
    const hasDone = !!document.querySelector('.mapmark-pop-done')
    const hasRing = !!document.querySelector('.mapmark-focus')
    return { hasSrc, hasDone, hasRing }
  })
  console.log(`[${label}] 클릭 후 — 출처링크:${pop.hasSrc} 완료버튼:${pop.hasDone} 강조링:${pop.hasRing}`)
  await shoot(`${label}-marker-focus`)

  // ② 완료 표시 토글 → done 클래스
  await page.evaluate(() => document.querySelector('.mapmark-pop-done')?.click())
  await wait(200)
  const doneCount = await page.evaluate(
    () => document.querySelectorAll('.mapmark.done').length,
  )
  console.log(`[${label}] 완료 표시 후 .done 마커: ${doneCount}개`)
  // 전체로 복귀
  await page.evaluate(() =>
    document.querySelector('.mapview-fit')?.click(),
  )
  await wait(500)
  await shoot(`${label}-marker-done`)

  // ③ 퀘스트별 마커 숨김 — 모든 눈 버튼을 꺼 마커가 0이 되는지 + 복구
  await page.evaluate(() =>
    document.querySelectorAll('.mapmark-eye').forEach((b) => b.click()),
  )
  await wait(250)
  const hiddenAll = await page.evaluate(() => ({
    markers: document.querySelectorAll('.mapmark').length,
    bar: document.querySelector('.planner-marker-bar')?.textContent?.trim(),
    showAll: !!document.querySelector('.planner-show-all'),
  }))
  console.log(
    `[${label}] 전부 숨김 — 마커 ${hiddenAll.markers}개 · 모두표시버튼:${hiddenAll.showAll} · 바:"${hiddenAll.bar}"`,
  )
  await shoot(`${label}-marker-hidden`)
  // "모두 표시" 복구
  await page.evaluate(() => document.querySelector('.planner-show-all')?.click())
  await wait(250)
  const restored = await page.evaluate(
    () => document.querySelectorAll('.mapmark').length,
  )
  console.log(`[${label}] 모두 표시 복구 — 마커 ${restored}개`)

  // localStorage 신규 키 기록 + 기존 키 보존 확인
  const ls = await page.evaluate(() => ({
    hidden: localStorage.getItem('tc:planner-hidden'),
    done: localStorage.getItem('tc:planner-done'),
    picksSeed: JSON.parse(localStorage.getItem('tc:planner-picks') || '{}').__seed,
  }))
  console.log(`[${label}] LS hidden=${ls.hidden} done=${ls.done} picks시드보존=${JSON.stringify(ls.picksSeed)}`)
}

await run('desktop', 1280, 900)
await run('m', 375, 812)

await browser.close()
console.log('완료')
