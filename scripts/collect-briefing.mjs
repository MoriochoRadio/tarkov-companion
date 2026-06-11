// 일일 브리핑 1단계: 소스 수집 (AI 불필요, Node 표준 fetch만 사용)
// 출력: tmp/collected.json
//
// 소스 하나가 실패해도 나머지로 계속 진행한다.
//
// 공식 뉴스(escapefromtarkov.com/news)는 JS 렌더링 SPA이고 내부 API도
// 외부 호출을 403으로 막아서(2026-06-11 확인) 수집 불가 →
// 공식 패치노트를 그대로 수록하는 EFT 위키 체인지로그로 대체.
import { mkdir, writeFile } from 'node:fs/promises'

const UA =
  'tarkov-companion-briefing/1.0 (github.com/MoriochoRadio/tarkov-companion)'
const FETCH_TIMEOUT = 15_000
// 체인지로그에서 이 일수보다 오래된 패치는 제외 (매일 같은 내용 반복 방지)
const CHANGELOG_MAX_AGE_DAYS = 7
const REDDIT_MAX_POSTS = 8

// 한국 시간 기준 날짜 (cron이 00:00 UTC = 09:00 KST에 돌지만,
// 수동 실행 시각이 언제든 한국 날짜가 나오도록 +9h 보정)
function kstDateString() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

// [[링크|표시명]] → 표시명, {{틀}} 제거 등 위키 문법 정리
function cleanWikitext(s) {
  return s
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .trim()
}

// EFT 위키 Changelog 페이지에서 최근 패치 섹션 추출
async function collectWikiChangelog() {
  const api =
    'https://escapefromtarkov.fandom.com/api.php?action=parse&page=Changelog&prop=wikitext&format=json&formatversion=2'
  const json = JSON.parse(await getText(api))
  const wikitext = json.parse.wikitext
  // "==1.0.5.0.45464 (10 June 2026)==" 형태의 레벨2 헤딩으로 분할
  const sections = wikitext.split(/^==(?!=)/m).slice(1)
  const items = []
  for (const sec of sections) {
    const headerEnd = sec.indexOf('==')
    if (headerEnd < 0) continue
    const heading = sec.slice(0, headerEnd).trim()
    const dateMatch = heading.match(/\((\d{1,2} \w+ \d{4})\)/)
    if (!dateMatch) continue
    const patchDate = new Date(`${dateMatch[1]} UTC`)
    if (Number.isNaN(patchDate.getTime())) continue
    const ageDays = (Date.now() - patchDate.getTime()) / 86_400_000
    if (ageDays > CHANGELOG_MAX_AGE_DAYS) break // 페이지가 최신순이므로 여기서 끝
    const bullets = sec
      .slice(headerEnd + 2)
      .split('\n')
      .filter((line) => line.startsWith('*'))
      .map((line) => cleanWikitext(line.replace(/^\*+\s*/, '')))
      .filter(Boolean)
      .slice(0, 25)
    if (bullets.length === 0) continue
    const anchor = heading.replace(/ /g, '_')
    items.push({
      title: `패치 ${heading}`,
      url: `https://escapefromtarkov.fandom.com/wiki/Changelog#${anchor}`,
      source: 'EFT 위키 체인지로그',
      content: bullets.join('\n'),
    })
  }
  return items
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// Reddit 일간 인기글 — JSON API는 외부 IP를 403으로 막지만 RSS는 열려 있음(2026-06-11 확인)
async function collectReddit() {
  const xml = await getText(
    'https://www.reddit.com/r/EscapefromTarkov/top/.rss?t=day&limit=10',
  )
  const items = []
  for (const entry of xml.split('<entry>').slice(1)) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)
    const link = entry.match(/<link href="([^"]+)"/)
    if (!title || !link) continue
    items.push({
      title: decodeEntities(title[1].trim()),
      url: decodeEntities(link[1]),
      source: 'Reddit r/EscapefromTarkov',
    })
    if (items.length >= REDDIT_MAX_POSTS) break
  }
  if (items.length === 0) throw new Error('RSS 응답에서 글을 찾지 못함')
  return items
}

const result = {
  date: kstDateString(),
  collectedAt: new Date().toISOString(),
  sources: {},
  errors: [],
}

for (const [name, collect] of [
  ['wikiChangelog', collectWikiChangelog],
  ['reddit', collectReddit],
]) {
  try {
    result.sources[name] = await collect()
    console.log(`✓ ${name}: ${result.sources[name].length}건`)
  } catch (err) {
    result.errors.push({ source: name, message: String(err) })
    console.error(`✗ ${name} 실패: ${err}`)
  }
}

await mkdir('tmp', { recursive: true })
await writeFile('tmp/collected.json', JSON.stringify(result, null, 2))
console.log(
  `수집 완료 → tmp/collected.json (성공 ${Object.keys(result.sources).length}, 실패 ${result.errors.length})`,
)
