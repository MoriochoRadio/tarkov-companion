// PWA 아이콘 생성: favicon.svg 모티프를 Chrome으로 렌더링해 PNG로 저장
// 사용: node scripts/make-icons.mjs — public/에 icon-192/512, maskable, apple-touch-icon 생성
// (아이콘이 바뀔 때만 다시 실행하면 됨 — 빌드 파이프라인에는 포함하지 않음)
import { writeFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// favicon.svg와 동일한 마크. 투명 배경판(일반 아이콘)용
const mark = `
  <rect x="2" y="2" width="60" height="60" rx="12" fill="#c9b482"/>
  <rect x="14" y="16" width="36" height="9" rx="2" fill="#101418"/>
  <rect x="27.5" y="25" width="9" height="23" rx="2" fill="#101418"/>`

// maskable/애플용: 가장자리가 잘려도 되는 풀블리드 배경 + 안전영역(중앙 80%) 안에 T
const fullBleed = `
  <rect width="64" height="64" fill="#c9b482"/>
  <rect x="17" y="19" width="30" height="7.5" rx="2" fill="#101418"/>
  <rect x="28.25" y="26.5" width="7.5" height="19" rx="2" fill="#101418"/>`

const ICONS = [
  { file: 'icon-192.png', size: 192, body: mark, transparent: true },
  { file: 'icon-512.png', size: 512, body: mark, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, body: fullBleed, transparent: false },
  { file: 'apple-touch-icon.png', size: 180, body: fullBleed, transparent: false },
]

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()

for (const { file, size, body, transparent } of ICONS) {
  await page.setViewport({ width: size, height: size })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${body}</svg>`
  await page.setContent(
    `<!doctype html><style>*{margin:0}body{background:transparent}</style>${svg}`,
  )
  const buf = await page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: transparent,
  })
  await writeFile(new URL(`../public/${file}`, import.meta.url), buf)
  console.log(`public/${file} (${size}x${size})`)
}

await browser.close()
