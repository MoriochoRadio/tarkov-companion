// 일일 브리핑 규칙 모음 — 네트워크·파일을 건드리지 않는 순수 함수만 둔다.
// collect-briefing.mjs / generate-briefing.mjs / generate-weekly.mjs가 가져다 쓰고,
// scripts/tests/briefing-rules.test.mjs가 네트워크 없이 검증한다 (npm test).

// ---------- fetch 재시도 (Reddit 429 대응) ----------

// 2026-10-05·10-06·11-10 브리핑에서 Reddit이 통째로 빠졌다. 세 번 모두 로그는
// "HTTP 429: …/top/.rss" — 예전 재시도는 3초·6초만 쉬고 다시 두드려서 레이트리밋 창이
// 풀리기 전에 3회를 다 써 버렸다. Reddit은 비로그인 요청에 x-ratelimit-remaining/
// x-ratelimit-reset(초) 헤더를 주므로(2026-11-16 실측: 요청 1번에 remaining 0, reset 9초)
// 그 시간만큼 기다렸다 다시 시도하면 된다. Retry-After가 오면 그것을 우선한다.
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

// 다음 재시도까지 기다릴 시간(ms). attempt는 방금 실패한 시도 번호(1부터).
// 헤더가 시키는 시간이 있으면 그대로(+1초 여유), 없으면 5초·15초·45초… 지수 백오프.
// 어떤 경우든 maxMs(기본 60초)를 넘기지 않는다 — job 타임아웃(15분) 안에서 끝나야 한다.
export function retryDelayMs(headers, attempt, { baseMs = 5000, maxMs = 60_000, now = Date.now() } = {}) {
  const get = (name) => headers?.get?.(name) ?? null
  let ms = NaN
  const retryAfter = get('retry-after')
  if (retryAfter != null) {
    const sec = Number(retryAfter)
    ms = Number.isFinite(sec) ? sec * 1000 : Date.parse(retryAfter) - now
  } else if (get('x-ratelimit-reset') != null) {
    const reset = Number(get('x-ratelimit-reset'))
    const remainingRaw = get('x-ratelimit-remaining')
    const exhausted = remainingRaw == null || Number(remainingRaw) < 1
    if (Number.isFinite(reset) && reset >= 0 && exhausted) ms = reset * 1000 + 1000
  }
  if (!Number.isFinite(ms) || ms < 0) ms = baseMs * 3 ** (attempt - 1)
  return Math.min(ms, maxMs)
}

// 재시도가 붙은 텍스트 fetch. 429·5xx·네트워크 오류만 다시 시도하고,
// 403·404처럼 다시 해도 소용없는 응답은 바로 실패시킨다.
// fetchImpl/sleep은 테스트에서 가짜로 갈아끼우려고 받는다.
export async function fetchTextWithRetry(
  url,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    headers = {},
    attempts = 4,
    timeoutMs = 15_000,
    baseMs = 5000,
    maxDelayMs = 60_000,
    log = () => {},
  } = {},
) {
  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      // 타임아웃·DNS 같은 네트워크 오류 — 헤더가 없으니 지수 백오프
      if (attempt >= attempts) throw err
      const wait = retryDelayMs(null, attempt, { baseMs, maxMs: maxDelayMs })
      log(`재시도 ${attempt}/${attempts - 1} (${err}) — ${Math.round(wait / 1000)}초 대기: ${url}`)
      await sleep(wait)
      continue
    }
    if (res.ok) return await res.text()
    const error = new Error(`HTTP ${res.status}: ${url}`)
    error.status = res.status
    if (!RETRYABLE_STATUS.has(res.status) || attempt >= attempts) throw error
    const wait = retryDelayMs(res.headers, attempt, { baseMs, maxMs: maxDelayMs })
    log(`재시도 ${attempt}/${attempts - 1} (HTTP ${res.status}) — ${Math.round(wait / 1000)}초 대기: ${url}`)
    await sleep(wait)
  }
}

// ---------- Reddit 분류 ----------

// 분류 규칙 — 제목의 [태그](= 서브레딧 플레어. 이 서브는 제목 태그를 강제한다)가 기준.
// label은 generate-briefing.mjs SECTION_PLAN의 feeds와 같은 문자열이어야 한다.
export const REDDIT_RULES = [
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
export const REDDIT_POPULAR = { label: '일간 인기', max: 8 }

export function redditTags(title) {
  return [...String(title).matchAll(/\[([^\]]{1,30})\]/g)].map((m) =>
    m[1].trim().toLowerCase(),
  )
}

// 예전엔 태그가 규칙에 안 걸리면 제목 키워드로 한 번 더 분류했다. 그런데 거의 모든 글에
// 태그가 붙어 있어서, [Discussion]·[Video]·[Suggestion]·[New Player] 글이 제목에
// "issue"·"tips"·"how to"가 들어 있다는 이유로 버그·공략 섹션에 들어갔다
// (10-01~11-16 버그·이슈 146건 중 23건, 공략·팁 16건 전부가 이런 경우 —
// 예: "[Discussion] Anybody else having issues finding Scavs to kill on Lighthouse?").
// → 글쓴이가 붙인 플레어를 존중한다: 태그가 하나라도 있으면 태그로만 판단하고,
//   규칙에 없는 태그(Discussion 등)는 일간 인기로 보낸다. 키워드는 태그가 아예 없을 때만.
export function classifyRedditPost(title) {
  const tags = redditTags(title)
  const byTag = REDDIT_RULES.find((r) => r.tags.some((t) => tags.includes(t)))
  if (byTag) return byTag
  if (tags.length > 0) return REDDIT_POPULAR
  return REDDIT_RULES.find((r) => r.words?.test(title)) ?? REDDIT_POPULAR
}

// ---------- YouTube 타르코프 영상 판별 ----------

// 타르코프 고유 단어. 해외 채널은 제목에 "Escape From Tarkov"를 거의 항상 붙이지만, 한국 채널은
// "타르코프" 없이 은어·맵·보스 이름만 쓰는 경우가 많아(예: "1시즌 3일차 쇄빙선 숏컷+웨지 잡기",
// "블디 SSD를 주워야 해") 그런 단어도 넣었다.
// Customs·Factory·Woods·공장·연구소처럼 다른 게임에도 흔한 단어는 뺐다.
export const TARKOV_KEYWORDS = new RegExp(
  [
    'tarkov', '\\beft\\b', '타르코프', '탈콥', '탈붕', '타르코인', '타르뱅크',
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

// 같은 채널에 자주 섞여 들어온 다른 게임 (2026-06~11 저장 데이터에서 실제로 새어 든 것 위주).
// 한국 채널은 "제목 | 게임명" 꼴로 게임을 밝히므로 게임명이 보이면 그 게임 영상으로 본다.
// 단 "Escape from Tarkov"/"Tarkov"를 영문으로 함께 적은 제목(비교 영상 등)은 살린다.
export const OTHER_GAMES = new RegExp(
  [
    'arena ?breakout', '\\babi\\b', '암흑구역',
    'gray ?zone', '\\bgzw\\b', '그레이존',
    'delta ?force', '델타포스', '三角洲',
    'war ?dogs', '워독스',
    'project ?zomboid', '좀보이드',
    'mistfall', 'stalzone', '스탈존',
    'arc ?raiders', '아크 ?레이더스',
    'hunt:? ?showdown', '\\bmarathon\\b',
  ].join('|'),
  'i',
)
const TARKOV_BY_NAME = /escape from tarkov|\btarkov\b/i
// 한국 채널의 2부제 방송 "1부 타르코프 / 2부 델타포스" — 절반은 타르코프라 살린다
const TARKOV_PART = /\d부\)?\s*(타르코프|탈콥)/

// 해시태그는 판단에서 뺀다 — 다른 게임 영상도 노출용으로 #tarkov #eft를 붙인다.
export function stripHashtags(s) {
  return String(s).replace(/#[^\s#]+/g, ' ')
}

// 제목만 본다. 예전엔 설명(description)까지 봤는데, 설명엔 채널 공통 문구·스폰서 링크·
// 해시태그(#tarkov)가 들어 있어서 Project Zomboid(Pestily "The Cure" 시리즈, 10~11월 매일)·
// 워독스(유우양)·ABI(LVNDMARK) 영상이 그대로 통과했다.
export function isTarkovVideo(title) {
  const t = stripHashtags(title)
  if (!TARKOV_KEYWORDS.test(t)) return false
  if (OTHER_GAMES.test(t) && !TARKOV_BY_NAME.test(t) && !TARKOV_PART.test(t)) return false
  return true
}

// Shorts 판별 — RSS에 영상 길이가 없어서 휴리스틱 사용:
// URL의 /shorts/ 경로, 제목·설명의 #shorts 태그
export function isShort(title, url, description = '') {
  if (String(url).includes('/shorts/')) return true
  return /#shorts?\b/i.test(`${title} ${description}`)
}

// ---------- 영상 중복 제거 ----------

export function youtubeVideoId(url) {
  const m = String(url ?? '').match(
    /(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/(?:shorts|live|embed)\/)([\w-]{11})/,
  )
  return m?.[1] ?? null
}

// 재업로드 판별용 제목 정규화 — 해시태그·문장부호·공백·대소문자 차이를 없앤다
export function normalizeTitle(title) {
  return stripHashtags(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

// 영상 목록에서 중복을 뺀다.
//  - 같은 영상 id: 오늘 목록 안에서도, 최근 며칠 브리핑(seenIds)에 이미 실린 것도 뺀다.
//    수집은 "최근 24시간" 창인데 실행 시각이 날마다 몇 시간씩 밀려서(스케줄 지연) 같은
//    영상이 이틀 연속 실렸다 (10-01~11-16 사이 12건, 예: 10-14·10-15 "SEASONAL PVP").
//  - 오늘 목록 안에서 정규화 제목이 같은 것(같은 영상을 다시 올린 경우)은 앞의 것만 남긴다.
//    날짜를 넘어서는 제목으로 지우지 않는다 — 스트림 다시보기처럼 제목이 매일 같지만
//    내용이 다른 영상이 있다.
export function dedupeVideos(items, seenIds = new Set()) {
  const ids = new Set()
  const titles = new Set()
  return items.filter((item) => {
    const id = youtubeVideoId(item.url)
    if (id && (ids.has(id) || seenIds.has(id))) return false
    const norm = normalizeTitle(item.title ?? '')
    if (norm && titles.has(norm)) return false
    if (id) ids.add(id)
    if (norm) titles.add(norm)
    return true
  })
}

// ---------- 소스 실패 시 이전 데이터 이어 붙이기 ----------

// 브리핑 섹션이 어느 수집 그룹 것인지 — 항목의 source 문자열로 판단한다
export function sectionGroup(section) {
  const src = section?.items?.find((i) => i?.source)?.source ?? ''
  if (src.startsWith('Reddit')) return 'reddit'
  if (src.startsWith('YouTube')) return 'youtube'
  if (src.startsWith('EFT 위키')) return 'wikiChangelog'
  if (src.startsWith('Steam')) return 'steam'
  return null
}

// group이 통째로 실패한 날, 가장 최근 브리핑(previous: 최신순 [{date, briefing}])에서
// 그 그룹 섹션을 가져와 "언제 수집한 글인지"를 붙여 돌려준다. 없으면 빈 배열.
// 이미 이어 붙인 섹션을 또 이어 붙이면 원래 수집 날짜(carriedFrom)를 그대로 유지한다.
export function carryOverSections(group, previous, today) {
  for (const { date, briefing } of previous) {
    const sections = (briefing?.sections ?? []).filter((s) => sectionGroup(s) === group)
    if (sections.length === 0) continue
    return sections.map((s) => {
      const from = s.carriedFrom ?? date
      const baseTitle = s.baseTitle ?? s.title
      const items = s.items.map(({ isNew, ...rest }) => rest) // 이어 붙인 글은 "새 글"이 아니다
      if (from === today) return { ...s, items } // 오늘 앞선 실행에서 받은 것 — 표시 그대로
      const md = from.slice(5).replace('-', '/')
      return {
        ...s,
        title: `${baseTitle} — ${md} 수집분 (오늘 수집 실패)`,
        baseTitle,
        carriedFrom: from,
        items,
      }
    })
  }
  return []
}
