// 일일 브리핑 1단계: 소스 수집 (AI 불필요, Node 표준 fetch만 사용)
// 출력: tmp/collected.json
//
// 소스 4그룹 — 어느 하나가 실패해도 나머지로 계속 진행한다:
//   wikiChangelog  EFT 위키 체인지로그 (MediaWiki API)
//   reddit         r/EscapefromTarkov 일간 인기글 RSS 1개 → 제목·플레어로 주제 분류
//   youtube        채널 RSS, 최근 24시간 신규 영상 (타르코프 영상만)
//   steam          Steam 뉴스 RSS (appid 3932890)
// 소스 전체 실패뿐 아니라 "일부 채널만 실패"도 result.errors에 남긴다(partial: true).
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
const VIDEO_MAX_AGE_HOURS = 24
const VIDEOS_PER_CHANNEL = 2
const STEAM_MAX_AGE_DAYS = 3

// 한국 시간 기준 날짜 (cron이 00:00 UTC = 09:00 KST에 돌지만,
// 수동 실행 시각이 언제든 한국 날짜가 나오도록 +9h 보정)
function kstDateString() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// 소스가 일시 5xx로 빠지면 guard 때문에 그날 브리핑 품질 저하가 고착됨 — 3회 백오프 재시도
async function getText(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
      return await res.text()
    } catch (e) {
      if (attempt >= 3) throw e
      await new Promise((r) => setTimeout(r, attempt * 3000))
    }
  }
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

// ---------- 2. Reddit (일간 인기 RSS 1개 → 제목·플레어로 로컬 분류) ----------

// Reddit JSON API는 외부 IP를 403으로 막지만 RSS는 열려 있음(2026-06-11 확인).
//
// 예전엔 일간 인기 + 주제별 검색 RSS(search.rss) 3개를 받았는데, 2026-08 말부터 검색 RSS가
// 거의 매일 HTTP 429(요청 과다)로 막혀 버그·이슈/공략 섹션이 사실상 사라졌다
// (08-20 이후 41일 중 3일만 성공). 인기글 피드(top/.rss)는 계속 200이다.
// → 검색 피드를 없애고, 인기글 피드 하나를 넉넉히 받아 제목으로 직접 분류한다.
//   요청이 4번 → 1번으로 줄어 레이트리밋에도 덜 걸린다. sort=top & t=day라
//   "유저 평가로 검증된 글만" 싣는다는 원칙은 그대로다.
//
// 플레어 실측(2026-08~09 브리핑의 Reddit 글 344건): 343건 제목에 [Discussion]·[Screenshot]·
// [Video]·[Bug]·[Feedback]·[Loot]·[Suggestion]·[IRL]·[Cheating]·[New Player] 같은 태그가
// 붙어 있다(대소문자 제각각, 앞·뒤 위치도 제각각).
const SUB = 'https://www.reddit.com/r/EscapefromTarkov'
const REDDIT_TOP_FEED = `${SUB}/top/.rss?t=day&limit=25`

// 분류 규칙 — 제목의 [태그]가 먼저, 그다음 키워드(예전 검색 RSS 쿼리와 같은 단어).
// 어느 쪽이든 위에 있는 규칙이 이긴다. 치터 동향은 예전에도 플레어로만 골랐다.
// label은 generate-briefing.mjs SECTION_PLAN의 feeds와 같은 문자열이어야 한다.
const REDDIT_RULES = [
  {
    label: '버그·이슈·PSA',
    max: 6,
    tags: ['bug', 'bugs', 'bug report', 'issue', 'psa'],
    words: /\b(bugs?|bugged|issues?|broken|desync(ed)?|psa)\b/i,
  },
  {
    label: '공략·팁',
    max: 5,
    tags: ['guide', 'tip', 'tips', 'tutorial'],
    words: /\b(guides?|tips?|how to)\b/i,
  },
  { label: '치터 동향', max: 4, tags: ['cheating', 'cheater', 'cheaters'] },
]
const REDDIT_POPULAR = { label: '일간 인기', max: 8 }

function classifyRedditPost(title) {
  const tags = [...title.matchAll(/\[([^\]]{1,30})\]/g)].map((m) =>
    m[1].trim().toLowerCase(),
  )
  const byTag = REDDIT_RULES.find((r) => r.tags.some((t) => tags.includes(t)))
  if (byTag) return byTag
  return REDDIT_RULES.find((r) => r.words?.test(title)) ?? REDDIT_POPULAR
}

// 본문 발췌 — 편집장이 제목만이 아니라 내용을 보고 선별할 수 있게
function extractExcerpt(entryXml) {
  const content = entryXml.match(/<content type="html">([\s\S]*?)<\/content>/)
  if (!content) return null
  const text = decodeEntities(decodeEntities(content[1])) // RSS가 HTML을 이중 이스케이프함
    .replace(/<[^>]+>/g, ' ')
    .replace(/submitted by\s+\/u\/\S+/i, '')
    .replace(/\[link\]|\[comments\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length >= 40 ? text.slice(0, 400) : null // 링크/짤 게시물은 본문이 없음
}

function parseAtomEntries(xml, max) {
  const items = []
  for (const entry of xml.split('<entry>').slice(1)) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)
    const link = entry.match(/<link href="([^"]+)"/)
    if (!title || !link) continue
    const excerpt = extractExcerpt(entry)
    items.push({
      title: decodeEntities(title[1].trim()),
      url: decodeEntities(link[1]),
      ...(excerpt ? { excerpt } : {}),
    })
    if (items.length >= max) break
  }
  return items
}

async function collectReddit() {
  const entries = parseAtomEntries(await getText(REDDIT_TOP_FEED), 25)
  if (entries.length === 0) {
    throw new Error('Reddit 인기글 피드에서 글을 하나도 읽지 못함')
  }
  const items = []
  const counts = new Map()
  for (const e of entries) {
    const rule = classifyRedditPost(e.title)
    const n = counts.get(rule.label) ?? 0
    if (n >= rule.max) continue // 피드가 인기순이라 앞쪽 글이 남는다
    counts.set(rule.label, n + 1)
    items.push({ ...e, feed: rule.label, source: 'Reddit r/EscapefromTarkov' })
  }
  for (const [label, n] of counts) console.log(`  reddit/${label}: ${n}건`)
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

// Shorts 판별 — RSS에 영상 길이가 없어서 휴리스틱 사용:
// URL의 /shorts/ 경로, 제목·설명의 #shorts 태그
function isShort(title, url, description) {
  if (url.includes('/shorts/')) return true
  return /#shorts?\b/i.test(`${title} ${description}`)
}

// 채널 피드엔 다른 게임 영상도 섞인다 (2026-08~09 237건 중 약 3분의 1 — 델타포스·워독스·
// Arena Breakout·Mistfall Hunter 등). 제목·설명에 타르코프 고유 단어가 있을 때만 싣는다.
// 해외 채널은 제목에 "Escape From Tarkov"를 거의 항상 붙이지만, 한국 채널은 "타르코프" 없이
// 은어·맵·보스 이름만 쓰는 경우가 많아(예: "1시즌 3일차 쇄빙선 숏컷+웨지 잡기",
// "블디 SSD를 주워야 해") 그런 단어도 넣었다. 설명에만 "타르코프 시즌1 영상"이 있는 경우도 있다.
// Customs·Factory·Woods·공장·연구소처럼 다른 게임에도 흔한 단어는 뺐다.
const TARKOV_KEYWORDS = new RegExp(
  [
    'tarkov', '\\beft\\b', '타르코프', '탈콥', '타르코인', '타르뱅크',
    // 맵 (tarkov.dev 한국어 이름)
    '세관', '삼림', '해안선', '리저브', '인터체인지', '등대', '쇄빙선', '그라운드 ?제로',
    // 보스·세력 (영문은 다른 게임과 겹치지 않는 이름만)
    'killa', 'tagilla', 'reshala', 'glukhar', 'shturman', 'kollontay', 'zryachiy',
    '킬라', '타길라', '[르레]샬라', '글루하', '슈[트투]르만', '세니타', '사니타르',
    '즈리야치', '콜론타이', '블디', '블랙 ?디비전',
    // 커뮤니티 은어 (카파 컨테이너, 퀘스트 "Shooter Born in Heaven")
    '카파', '슈본헤',
  ].join('|'),
  'i',
)

function isTarkovVideo(title, description) {
  return TARKOV_KEYWORDS.test(`${title}\n${description}`)
}

async function collectYouTube(reportPartial) {
  const cutoff = Date.now() - VIDEO_MAX_AGE_HOURS * 3600 * 1000
  const items = []
  const failures = []
  for (const ch of YOUTUBE_CHANNELS) {
    try {
      const xml = await getText(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`,
      )
      let kept = 0
      for (const entry of xml.split('<entry>').slice(1)) {
        if (kept >= VIDEOS_PER_CHANNEL) break // 피드는 최신순
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)
        const link = entry.match(/<link rel="alternate" href="([^"]+)"/)
        const published = entry.match(/<published>([^<]+)<\/published>/)
        const desc = entry.match(/<media:description>([\s\S]*?)<\/media:description>/)
        if (!title || !link || !published) continue
        if (new Date(published[1]).getTime() < cutoff) continue
        const titleText = decodeEntities(title[1].trim())
        const url = decodeEntities(link[1])
        const descText = desc ? decodeEntities(desc[1]) : ''
        if (isShort(titleText, url, descText)) continue
        if (!isTarkovVideo(titleText, descText)) {
          console.log(`  youtube/${ch.name}: 타르코프 영상 아님 → 제외: ${titleText}`)
          continue
        }
        items.push({
          title: titleText,
          url,
          channel: ch.name,
          source: `YouTube ${ch.name}`,
          publishedAt: published[1],
        })
        kept += 1
      }
    } catch (err) {
      failures.push(`${ch.name}: ${err}`)
      console.error(`  youtube/${ch.name} 실패: ${err}`)
    }
  }
  if (failures.length === YOUTUBE_CHANNELS.length) {
    throw new Error(`모든 YouTube 채널 피드 실패 (${failures.join(' / ')})`)
  }
  // 일부 채널만 실패 — 나머지로 계속 가되 errors에는 남긴다 (예전엔 로그에만 찍혀 "실패 0"으로 보였다)
  for (const f of failures) reportPartial(f)
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
  // 소스 안의 일부 피드만 실패한 경우 — 수집은 계속하되 errors에 partial로 남긴다
  const reportPartial = (message) =>
    result.errors.push({ source: name, partial: true, message: String(message) })
  try {
    result.sources[name] = await collect(reportPartial)
    console.log(`✓ ${name}: ${result.sources[name].length}건`)
  } catch (err) {
    result.errors.push({ source: name, message: String(err) })
    console.error(`✗ ${name} 실패: ${err}`)
  }
}

await mkdir('tmp', { recursive: true })
await writeFile('tmp/collected.json', JSON.stringify(result, null, 2))
const partialCount = result.errors.filter((e) => e.partial).length
console.log(
  `수집 완료 → tmp/collected.json (성공 ${Object.keys(result.sources).length}, 실패 ${result.errors.length - partialCount}, 일부 실패 ${partialCount})`,
)
