// 3D 폴백 포스터 생성: 풀스크린 뷰어를 띄워 무기별로 캡처 → public/models/poster-*.png
// (모델이 바뀔 때만 다시 실행하면 됨)
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:4173/tarkov-companion/'
const WEAPONS = ['ak47', 'assault-rifle'] // src/lib/weapons.ts 순서와 동일해야 함

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
// 자동 회전을 멈춰 기본(측면) 각도로 고정
await page.emulateMediaFeatures([
  { name: 'prefers-reduced-motion', value: 'reduce' },
])
await page.evaluateOnNewDocument(() => localStorage.setItem('tc:visited', '1'))
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })

// 위젯 lazy 로드 기다렸다가 모달 오픈
await new Promise((r) => setTimeout(r, 4000))
await page.click('.weapon-widget')
await page.waitForSelector('.weapon-stage.stage-modal', { timeout: 15_000 })
// 포스터는 깨끗한 단색 배경이어야 함 — 반투명 백드롭을 불투명으로
await page.evaluate(() => {
  document.querySelector('.weapon-modal').style.background = '#101418'
})

for (let i = 0; i < WEAPONS.length; i++) {
  if (i > 0) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.weapon-controls .quest-back')]
      btns[1].click() // 다음 무기
    })
  }
  // 모델 로드 + 페이드 + 보기 좋은 각도까지 회전 대기
  await new Promise((r) => setTimeout(r, 2600))
  const stage = await page.$('.weapon-stage.stage-modal')
  const box = await stage.boundingBox()
  await page.screenshot({
    path: `public/models/poster-${WEAPONS[i]}.png`,
    clip: box,
  })
  console.log(`public/models/poster-${WEAPONS[i]}.png`)
}
await browser.close()
