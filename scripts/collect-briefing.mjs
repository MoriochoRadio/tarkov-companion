// 일일 브리핑 1단계: 소스 수집 (AI 불필요, Node 표준 fetch만 사용)
// 출력: tmp/collected.json
//
// 소스 4그룹 — 어느 하나가 실패해도 나머지로 계속 진행한다:
//   wikiChangelog  EFT 위키 체인지로그 (MediaWiki API)
//   reddit         r/EscapefromTarkov 일간 인기글 + 주제별 검색 RSS
//   youtube        채널 RSS, 최근 24시간 신규 영상
//   steam          Steam 뉴스 RSS (appid 3932890)
//
// 공식 뉴스(escapefromtarkov.com/news)는 JS 렌더링 SPA이고 내부 API도
// 외부 호출을 403으로 막아서(2026-06-11 확인) 수집 불가 →
// 공식 패치노트를 그대로 수록하는 EFT 위키 체인지로그로 대체.
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

const UA =
  'tarkov-companion-briefing/1.0 (github.com/MoriochoRadio/tarkov-companion)'
const FETCH_TIMEOUT = 15_000
// 체인지로그에서 이 일수보다 오래된 패치는 제외 (매일 같은 내용 반복 방지)
const CHANGELOG_MAX_AGE_DAYS = 7
const VIDEO_MAX_AGE_HOURS = 24
const STEAM_MAX_AGE_DAYS = 3

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

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// ---------- 1. EFT 위키 체인지로그 ----------

// [[링크|표시명]] → 표시명, {{틀}} 제거 등 위키 문법 정리
function cleanWikitext(s) {
  return s
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .trim()
}

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

// ---------- 2. Reddit (일간 인기 + 주제별 검색 RSS) ----------

// Reddit JSON API는 외부 IP를 403으로 막지만 RSS는 열려 있음(2026-06-11 확인).
//
// 플레어 실측 결과(2026-06-11, 검색 RSS 프로브 32종):
//   실존 플레어 = Discussion, General, PVE, PVP, Arena, Cheating
//   버그/PSA/공략 "전용" 플레어는 존재하지 않음 → 해당 주제는 키워드 검색 RSS로 구성
const SUB = 'https://www.reddit.com/r/EscapefromTarkov'

function searchFeed(query, sort, t) {
  return `${SUB}/search.rss?q=${encodeURIComponent(query)}&restrict_sr=on&sort=${sort}&t=${t}`
}

const REDDIT_FEEDS = [
  { label: '일간 인기', max: 8, url: `${SUB}/top/.rss?t=day&limit=10` },
  {
    label: '버그·이슈·PSA',
    max: 6,
    url: searchFeed(
      'title:bug OR title:issue OR title:broken OR title:desync OR title:PSA',
      'top',
      'day',
    ),
  },
  {
    label: '치터 동향', // Cheating은 실존 플레어
    max: 4,
    url: searchFeed('flair:"Cheating"', 'top', 'day'),
  },
  {
    label: '공략·팁', // 공략 글은 유효기간이 길어 주간 톱으로
    max: 5,
    url: searchFeed('title:guide OR title:tip OR title:"how to"', 'top', 'week'),
  },
]

function parseAtomEntries(xml, max) {
  const items = []
  for (const entry of xml.split('<entry>').slice(1)) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)
    const link = entry.match(/<link href="([^"]+)"/)
    if (!title || !link) continue
    items.push({
      title: decodeEntities(title[1].trim()),
      url: decodeEntities(link[1]),
    })
    if (items.length >= max) break
  }
  return items
}

async function collectReddit() {
  const items = []
  const seen = new Set()
  const failures = []
  for (const feed of REDDIT_FEEDS) {
    try {
      const xml = await getText(feed.url)
      const entries = parseAtomEntries(xml, feed.max)
      for (const e of entries) {
        if (seen.has(e.url)) continue // 피드 간 중복 제거
        seen.add(e.url)
        items.push({ ...e, feed: feed.label, source: 'Reddit r/EscapefromTarkov' })
      }
      console.log(`  reddit/${feed.label}: ${entries.length}건`)
    } catch (err) {
      failures.push(feed.label)
      console.error(`  reddit/${feed.label} 실패: ${err}`)
    }
    await sleep(2000) // 무인증 레이트리밋 회피용 간격
  }
  if (items.length === 0) {
    throw new Error(`모든 Reddit 피드 실패 (${failures.join(', ')})`)
  }
  return items
}

// ---------- 3. YouTube 채널 RSS (최근 24시간 신규 영상) ----------

// channel_id는 2026-06-11 핸들/검색 → feeds/videos.xml 채널명 대조로 검증함
const YOUTUBE_CHANNELS = [
  { name: '노잼망겜', id: 'UC716t6H_mKuQ8VLdkxL67pA' }, // 한국, 타르코프 소식/해설
  { name: '유우양', id: 'UCfErRnESYXp86XRZVNZYK_g' }, // 한국, 타르코프 플레이
  { name: 'Pestily', id: 'UCY_SWo3a9cehkqCZ-Yuh_kw' }, // 해외 (채널명 PestilyTV)
  { name: 'LVNDMARK', id: 'UCOhsgjMEyldgS04MiP2x-zA' }, // 해외 본채널 (클립 채널 아님)
]

async function collectYouTube() {
  const cutoff = Date.now() - VIDEO_MAX_AGE_HOURS * 3600 * 1000
  const items = []
  const failures = []
  for (const ch of YOUTUBE_CHANNELS) {
    try {
      const xml = await getText(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`,
      )
      for (const entry of xml.split('<entry>').slice(1)) {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)
        const link = entry.match(/<link rel="alternate" href="([^"]+)"/)
        const published = entry.match(/<published>([^<]+)<\/published>/)
        if (!title || !link || !published) continue
        if (new Date(published[1]).getTime() < cutoff) continue
        items.push({
          title: decodeEntities(title[1].trim()),
          url: decodeEntities(link[1]),
          channel: ch.name,
          source: `YouTube ${ch.name}`,
          publishedAt: published[1],
        })
      }
    } catch (err) {
      failures.push(ch.name)
      console.error(`  youtube/${ch.name} 실패: ${err}`)
    }
  }
  if (failures.length === YOUTUBE_CHANNELS.length) {
    throw new Error('모든 YouTube 채널 피드 실패')
  }
  return items // 신규 영상이 없는 날은 빈 배열 (정상)
}

// ---------- 4. Steam 뉴스 RSS ----------

async function collectSteam() {
  const xml = await getText(
    'https://store.steampowered.com/feeds/news/app/3932890/',
  )
  const cutoff = Date.now() - STEAM_MAX_AGE_DAYS * 86_400_000
  const items = []
  for (const item of xml.split('<item>').slice(1)) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/)
    const link = item.match(/<link>([\s\S]*?)<\/link>/)
    const pubDate = item.match(/<pubDate>([^<]+)<\/pubDate>/)
    const desc = item.match(/<description>([\s\S]*?)<\/description>/)
    if (!title || !link || !pubDate) continue
    if (new Date(pubDate[1]).getTime() < cutoff) continue
    const text = desc
      ? decodeEntities(desc[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : ''
    items.push({
      title: decodeEntities(title[1].trim()),
      url: decodeEntities(link[1].trim()),
      source: 'Steam 뉴스',
      content: text.slice(0, 400),
    })
    if (items.length >= 5) break
  }
  return items // 새 뉴스가 없는 날은 빈 배열 (정상)
}

// ---------- 메인 ----------

const result = {
  date: kstDateString(),
  collectedAt: new Date().toISOString(),
  sources: {},
  errors: [],
}

for (const [name, collect] of [
  ['wikiChangelog', collectWikiChangelog],
  ['reddit', collectReddit],
  ['youtube', collectYouTube],
  ['steam', collectSteam],
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
