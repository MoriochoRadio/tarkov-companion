// 브리핑 규칙 테스트 — 네트워크 없이 돈다: npm test (= node --test scripts/tests/)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  carryOverSections,
  classifyRedditPost,
  dedupeVideos,
  fetchTextWithRetry,
  isShort,
  isTarkovVideo,
  normalizeTitle,
  retryDelayMs,
  sectionGroup,
  youtubeVideoId,
} from '../briefing-rules.mjs'

// ---------- Reddit 분류 ----------

test('[Discussion] 글은 제목에 issue·tips·how to가 있어도 일간 인기로 간다', () => {
  // 실제로 버그·공략 섹션에 잘못 들어갔던 제목들 (2026-10~11 저장 데이터)
  for (const title of [
    '[Discussion] Anybody else having issues finding Scavs to kill on Lighthouse?',
    '[Discussion] Is anyone else having stability issues on PVE?',
    'Your stash size isnt bugged it was fixed. [Discussion]',
    '[Discussion] Tips for progressing wedge on Icebreaker?',
    'How to level up armor and weapon maintenance? [Discussion]',
    '[discussion] [feedback] The most bugged game i\'ve ever had #bsg',
    '[Video] Is this just DESYNC?? - invisible players or flashlight floating?',
    'I think this is the most broken weekly quest I have ever seen [Loot]',
    'How to learn the maps? Noob here [New Player]',
    '[Suggestion] Tips for a level 18 PMC clearing Icebreaker?',
  ]) {
    assert.equal(classifyRedditPost(title).label, '일간 인기', title)
  }
})

test('규칙 태그는 위치·대소문자와 무관하게 이긴다 (다른 태그와 함께 있어도)', () => {
  assert.equal(classifyRedditPost('[BUG] Why are Rogues still so broken?').label, '버그·이슈·PSA')
  assert.equal(classifyRedditPost('Stash bug. [Bug]').label, '버그·이슈·PSA')
  assert.equal(
    classifyRedditPost("[Screenshot] [Bug] What's up with BD wearing NVGs").label,
    '버그·이슈·PSA',
  )
  assert.equal(classifyRedditPost('[Discussion] [PSA] Check your stash').label, '버그·이슈·PSA')
  assert.equal(classifyRedditPost('[Cheating] blatant aimbot on Labs').label, '치터 동향')
  assert.equal(classifyRedditPost('[Guide] Lighthouse rework keys').label, '공략·팁')
})

test('태그가 아예 없는 글만 키워드로 분류한다', () => {
  assert.equal(classifyRedditPost('Fuel is bugged again after the patch').label, '버그·이슈·PSA')
  assert.equal(classifyRedditPost('How to get Kappa fast').label, '공략·팁')
  assert.equal(classifyRedditPost('We have reached a larger audience').label, '일간 인기')
})

// ---------- YouTube 필터 ----------

test('저장 데이터에 새어 들었던 다른 게임 영상은 걸러진다', () => {
  for (const title of [
    'The Hunt for Books & VHS Tapes - The Cure #3 feat. @MrDrakezilla - Project Zomboid',
    'CHECKING OUT ABI SEASON 7',
    '1부 델타포스 #광고 / 2부 워독스 Wardogs',
    'ㅋㅋㅋ 적 기지에 분탕치는 법 | 워독스 Wardogs',
    '워독스 시즌2, 무엇이 달라질까? 핵심 패치노트 총정리 | Wardogs',
    '아시아 차별 논란에 도게자 박은 게임사 | 워독스 치터 비율이 제일 높았던 지역 공개 | 시즌3 개막, 신규 시가전맵 추가 | Wardogs',
    // 타르코프 은어(슈본헤)가 있어도 게임명이 다른 게임이면 제외
    '슈본헤로 갈고 닦은 똥쟁이 실력 | 워독스, WarDogs',
    '신작 100명 대규모 전투. 돈벌어서 무장 사는 게임 (탈콥 + 델타포스 전면전 느낌)',
  ]) {
    assert.equal(isTarkovVideo(title), false, title)
  }
})

test('해시태그로만 타르코프를 단 제목은 통과하지 못한다', () => {
  assert.equal(isTarkovVideo('Insane clutch in ranked #tarkov #eft #fps'), false)
  assert.equal(isTarkovVideo('신작 FPS 첫인상 #타르코프'), false)
})

test('타르코프 영상은 그대로 통과한다 (영문 게임명·한국 은어·맵 이름)', () => {
  for (const title of [
    'Wiping DORMS with the  .45 Vector - Escape From Tarkov',
    'This is PEAK Tarkov (The KS-23 Factory Experience)',
    'ESCAPE FROM TARKOV - SEASONAL PVP',
    '1시즌 3일차 쇄빙선 숏컷+웨지 잡기',
    '블디 SSD를 주워야 해',
    '타르코프 미니맵 내비 도입? GPS 공개 | Escape from Tarkov',
    '니키타에게 또 속을 것인가? | 우주 타르코프, 최초 플레이 영상 공개 | Fragmentary Order',
    // 영문 Tarkov를 함께 적은 비교 영상은 살린다
    'Tarkov vs Arena Breakout - which one is harder?',
    // 2부제 방송에서 한 부가 타르코프면 살린다
    '1부 타르코프 / 2부 델타포스',
    '2부 델타포스 / 1부 탈콥 배패 문서 줍기',
  ]) {
    assert.equal(isTarkovVideo(title), true, title)
  }
})

test('Shorts 판별', () => {
  assert.equal(isShort('a', 'https://www.youtube.com/shorts/abcdefghijk'), true)
  assert.equal(isShort('clip #shorts', 'https://www.youtube.com/watch?v=abcdefghijk'), true)
  assert.equal(isShort('clip', 'https://www.youtube.com/watch?v=abcdefghijk', ''), false)
})

// ---------- 영상 중복 제거 ----------

test('youtubeVideoId는 URL 형태가 달라도 같은 id를 낸다', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=4lx5rBu6-ow',
    'https://www.youtube.com/watch?feature=share&v=4lx5rBu6-ow',
    'https://youtu.be/4lx5rBu6-ow',
    'https://www.youtube.com/shorts/4lx5rBu6-ow',
  ]) {
    assert.equal(youtubeVideoId(url), '4lx5rBu6-ow', url)
  }
  assert.equal(youtubeVideoId('https://www.reddit.com/r/x'), null)
})

test('dedupeVideos: 같은 id·최근 브리핑에 실린 id·같은 제목 재업로드를 뺀다', () => {
  const v = (id, title) => ({ title, url: `https://www.youtube.com/watch?v=${id}` })
  const out = dedupeVideos(
    [
      v('aaaaaaaaaaa', 'Taking the G36 to Customs - Escape From Tarkov'),
      v('aaaaaaaaaaa', 'Taking the G36 to Customs - Escape From Tarkov'), // 같은 영상
      { title: 'dup by other url', url: 'https://youtu.be/aaaaaaaaaaa' }, // 같은 id
      v('bbbbbbbbbbb', 'Baddie is Carrying - The Sherpa #3 - Escape from Tarkov'), // 어제 실림
      v('ccccccccccc', 'taking the g36 to customs — escape from tarkov!!'), // 재업로드
      v('ddddddddddd', 'ESCAPE FROM TARKOV - SEASONAL PVP'),
    ],
    new Set(['bbbbbbbbbbb']),
  )
  assert.deepEqual(
    out.map((i) => youtubeVideoId(i.url)),
    ['aaaaaaaaaaa', 'ddddddddddd'],
  )
})

test('normalizeTitle은 해시태그·문장부호·대소문자를 무시한다', () => {
  assert.equal(normalizeTitle('Hello, World! #tarkov'), normalizeTitle('hello world'))
})

// ---------- 재시도 ----------

const headers = (obj) => new Headers(obj)

test('retryDelayMs: Retry-After(초·날짜)와 x-ratelimit-reset을 따른다, 상한 60초', () => {
  assert.equal(retryDelayMs(headers({ 'retry-after': '7' }), 1), 7000)
  const now = Date.parse('2026-11-16T00:00:00Z')
  assert.equal(
    retryDelayMs(headers({ 'retry-after': 'Mon, 16 Nov 2026 00:00:20 GMT' }), 1, { now }),
    20_000,
  )
  // Reddit 실측 헤더: remaining 0, reset 9초 → 9초 + 여유 1초
  assert.equal(
    retryDelayMs(headers({ 'x-ratelimit-remaining': '0.0', 'x-ratelimit-reset': '9' }), 1),
    10_000,
  )
  assert.equal(retryDelayMs(headers({ 'retry-after': '3600' }), 1), 60_000)
  // 헤더 없음 → 5초·15초·45초 지수 백오프
  assert.deepEqual([1, 2, 3].map((a) => retryDelayMs(headers({}), a)), [5000, 15_000, 45_000])
})

function fakeFetch(responses) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    const r = responses.shift()
    if (r instanceof Error) throw r
    return new Response(r.body ?? '', { status: r.status, headers: r.headers ?? {} })
  }
  return { impl, calls }
}

test('fetchTextWithRetry: 429 뒤 헤더만큼 쉬고 다시 시도해 성공한다', async () => {
  const { impl, calls } = fakeFetch([
    { status: 429, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9' } },
    { status: 429, headers: { 'retry-after': '2' } },
    { status: 200, body: '<feed/>' },
  ])
  const waits = []
  const text = await fetchTextWithRetry('https://example.test/feed', {
    fetchImpl: impl,
    sleep: async (ms) => waits.push(ms),
  })
  assert.equal(text, '<feed/>')
  assert.equal(calls.length, 3)
  assert.deepEqual(waits, [10_000, 2000])
})

test('fetchTextWithRetry: 시도 횟수를 넘기면 마지막 HTTP 오류를 던진다', async () => {
  const { impl, calls } = fakeFetch([
    { status: 429 },
    { status: 503 },
    { status: 429 },
    { status: 429 },
  ])
  await assert.rejects(
    fetchTextWithRetry('https://example.test/feed', { fetchImpl: impl, sleep: async () => {} }),
    /HTTP 429/,
  )
  assert.equal(calls.length, 4)
})

test('fetchTextWithRetry: 403·404는 재시도하지 않는다, 네트워크 오류는 재시도한다', async () => {
  const notFound = fakeFetch([{ status: 404 }, { status: 200, body: 'x' }])
  await assert.rejects(
    fetchTextWithRetry('https://example.test/a', { fetchImpl: notFound.impl, sleep: async () => {} }),
    /HTTP 404/,
  )
  assert.equal(notFound.calls.length, 1)

  const flaky = fakeFetch([new TypeError('fetch failed'), { status: 200, body: 'ok' }])
  const text = await fetchTextWithRetry('https://example.test/b', {
    fetchImpl: flaky.impl,
    sleep: async () => {},
  })
  assert.equal(text, 'ok')
})

// ---------- 이어 붙이기 ----------

const redditSection = (title, n = 2) => ({
  type: 'community',
  title,
  items: Array.from({ length: n }, (_, k) => ({
    title: `post ${k}`,
    url: `https://www.reddit.com/r/EscapefromTarkov/comments/${title.length}${k}/`,
    source: 'Reddit r/EscapefromTarkov',
    isNew: true,
  })),
})

test('sectionGroup은 항목 출처로 소스를 판단한다', () => {
  assert.equal(sectionGroup(redditSection('x')), 'reddit')
  assert.equal(sectionGroup({ items: [{ source: 'YouTube Pestily' }] }), 'youtube')
  assert.equal(sectionGroup({ items: [{ title: '안내' }] }), null)
})

test('carryOverSections: 가장 최근 Reddit 섹션을 날짜 표시와 함께 이어 싣고 isNew를 뗀다', () => {
  const previous = [
    { date: '2026-11-09', briefing: { sections: [redditSection('오늘의 인기 글 (Reddit)')] } },
    { date: '2026-11-08', briefing: { sections: [redditSection('older')] } },
  ]
  const out = carryOverSections('reddit', previous, '2026-11-10')
  assert.equal(out.length, 1)
  assert.equal(out[0].title, '오늘의 인기 글 (Reddit) — 11/09 수집분 (오늘 수집 실패)')
  assert.equal(out[0].carriedFrom, '2026-11-09')
  assert.ok(out[0].items.every((i) => !('isNew' in i)))

  // 이어 붙인 섹션을 다음 날 또 이어 붙여도 원래 날짜·제목이 유지된다
  const again = carryOverSections('reddit', [{ date: '2026-11-10', briefing: { sections: out } }], '2026-11-11')
  assert.equal(again[0].carriedFrom, '2026-11-09')
  assert.equal(again[0].title, out[0].title)
})

test('carryOverSections: 오늘 앞선 실행분이면 표시를 붙이지 않고, 없으면 빈 배열', () => {
  const today = carryOverSections(
    'reddit',
    [{ date: '2026-11-10', briefing: { sections: [redditSection('오늘의 인기 글 (Reddit)')] } }],
    '2026-11-10',
  )
  assert.equal(today[0].title, '오늘의 인기 글 (Reddit)')
  assert.equal(today[0].carriedFrom, undefined)
  assert.deepEqual(carryOverSections('reddit', [{ date: '2026-11-09', briefing: { sections: [] } }], '2026-11-10'), [])
})
