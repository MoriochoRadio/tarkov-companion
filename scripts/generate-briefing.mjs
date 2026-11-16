// 일일 브리핑 2단계: 수집 결과 → 스키마(docs/briefing-schema.md) JSON 생성
// 입력: tmp/collected.json (collect-briefing.mjs 출력)
// 출력: public/data/briefings/<날짜>.json + index.json 갱신
//
// AI 요약은 쓰지 않는다 (Phase 45). GitHub Models가 2026-07-30 폐지됐고 "모든 것이 무료"
// 제약을 지키면서 대체할 만한 곳이 마땅치 않아, 규칙 기반 큐레이션으로 확정했다.
// AI가 하던 일 중 규칙으로 대신할 수 있는 것은 살렸다:
//   - 분류: 수집기가 붙여 준 피드 라벨(버그·이슈·PSA / 공략·팁 / 치터 동향 …)로 섹션 배정
//   - 중복 제거: URL 기준 전역 1회 (같은 글이 여러 피드에 걸리는 경우가 흔함)
//   - isNew: 어제 브리핑의 URL 집합과 대조 (AI 판정보다 오히려 정확)
// 못 하는 것은 번역·통합 요약이다 — 원문(영어) 발췌를 그대로 싣고 출처를 명시한다.
// 원문을 그대로 싣는 대신 욕설 단어는 가린다 (mask-profanity.mjs).
//
// 소스가 통째로 실패한 날(주로 Reddit 429)은 빈 섹션으로 덮어쓰지 않는다:
//   - Reddit은 최근 브리핑의 Reddit 섹션을 "MM/DD 수집분 (오늘 수집 실패)"로 표시해 이어 싣는다
//   - 출력에 degraded: [실패한 소스]를 남긴다 → daily-briefing.yml guard가 이 표시를 보고
//     백업 cron에서 다시 수집한다(정상 파일만 skip). 다시 성공하면 오늘 글로 바뀐다
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { maskProfanity } from './mask-profanity.mjs'
import { carryOverSections, dedupeVideos, youtubeVideoId } from './briefing-rules.mjs'

// 로컬 테스트 시 실제 데이터를 건드리지 않도록 OUTPUT_DIR로 출력 경로 변경 가능
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'public/data/briefings'

const collected = JSON.parse(await readFile('tmp/collected.json', 'utf8'))
const date = collected.date
// toISOString은 UTC(Z) 표기라서, +9h 보정한 시각에 +09:00을 붙여 KST로 표현
const generatedAt = new Date(Date.now() + 9 * 3600 * 1000)
  .toISOString()
  .replace('Z', '+09:00')

// ---------- 섹션 구성 ----------

// 수집 그룹(+Reddit 피드 라벨)을 브리핑 섹션에 배정한다.
// 순서가 그대로 브리핑 순서이자 중복 제거 우선순위 — 위쪽 섹션이 URL을 선점한다.
// warning은 "모르면 손해 보는 것"만 (버그·PSA). 치터 동향은 정보성이라 community로 둔다.
const SECTION_PLAN = [
  { group: 'wikiChangelog', type: 'news', title: '패치노트 (EFT 위키)', max: 6 },
  { group: 'steam', type: 'news', title: 'Steam 공식 소식', max: 5 },
  {
    group: 'reddit',
    feeds: ['버그·이슈·PSA'],
    type: 'warning',
    title: '버그·이슈 제보 (Reddit)',
    max: 6,
  },
  {
    group: 'reddit',
    feeds: ['공략·팁'],
    type: 'tips',
    title: '공략·팁 (Reddit)',
    max: 5,
  },
  {
    group: 'reddit',
    feeds: ['치터 동향'],
    type: 'community',
    title: '치터 동향 (Reddit)',
    max: 4,
  },
  {
    group: 'reddit',
    feeds: ['일간 인기'],
    type: 'community',
    title: '오늘의 인기 글 (Reddit)',
    max: 6,
  },
  { group: 'youtube', type: 'videos', title: '신규 영상', max: 8 },
]

const SUMMARY_MAX = 400

// 원문 발췌 정리 — 빈 줄을 접고 길면 자른다 (번역은 하지 않으므로 원문 그대로)
function excerptOf(item, type) {
  // 영상은 제목이 전부라 없는 내용을 지어내지 않는다
  if (type === 'videos') return null
  const raw = item.summary ?? item.excerpt ?? item.content ?? ''
  const text = String(raw).replace(/\n{2,}/g, '\n').trim()
  if (!text) return null
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

// 이 소스가 통째로 실패한 날엔 최근 브리핑의 같은 소스 섹션을 이어 싣는다.
// Reddit만 — 영상은 어제 것을 다시 실으면 그게 곧 중복이고, 위키·Steam은 원래 며칠치를
// 다시 훑는 소스라 하루 실패해도 다음 실행에서 그대로 돌아온다.
const CARRY_OVER_GROUPS = ['reddit']
const CARRY_OVER_LOOKBACK_DAYS = 3
// 이 일수 안의 브리핑에 이미 실린 영상 id는 다시 싣지 않는다
const VIDEO_DEDUPE_DAYS = 3

function shiftDate(d, days) {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

async function loadBriefing(d) {
  try {
    return JSON.parse(await readFile(path.join(OUTPUT_DIR, `${d}.json`), 'utf8'))
  } catch {
    return null // 파일 없음 (첫 실행·공백일)
  }
}

// 오늘 파일(앞선 실행 결과 — 백업 cron 재수집·수동 재실행 때 있음) + 지난 며칠치, 최신순
const todayExisting = await loadBriefing(date)
const previousDays = []
for (let k = 1; k <= Math.max(CARRY_OVER_LOOKBACK_DAYS, VIDEO_DEDUPE_DAYS); k++) {
  const d = shiftDate(date, -k)
  const b = await loadBriefing(d)
  if (b) previousDays.push({ date: d, briefing: b, ago: k })
}

// 어제 브리핑의 URL 집합 — isNew 판정 기준 (없으면 null → 아무 데도 isNew를 붙이지 않음)
function urlsOf(briefing) {
  const urls = new Set()
  for (const s of briefing?.sections ?? []) {
    for (const i of s.items ?? []) if (i.url) urls.add(i.url)
  }
  return urls
}
const yesterday = previousDays.find((p) => p.ago === 1)
const yesterdayUrls = yesterday ? urlsOf(yesterday.briefing) : null

// 최근 며칠 브리핑에 실린 영상 id (오늘 파일은 빼고 — 오늘 것은 이번 실행이 새로 만든다)
const recentVideoIds = new Set()
for (const p of previousDays) {
  if (p.ago > VIDEO_DEDUPE_DAYS) continue
  for (const url of urlsOf(p.briefing)) {
    const id = youtubeVideoId(url)
    if (id) recentVideoIds.add(id)
  }
}

// 통째로 실패한 소스 (일부 채널만 실패한 partial은 제외)
const failedGroups = new Map()
for (const e of collected.errors ?? []) {
  if (!e.partial && !failedGroups.has(e.source)) failedGroups.set(e.source, e.message)
}

const degraded = new Set(failedGroups.keys())

// 오늘 앞선 실행분은 어느 소스든 그대로 유지한다(백업 cron 재수집 때 아침엔 됐던 소스가
// 이번엔 실패해도 지우지 않게). 지난 날짜 것까지 이어 싣는 건 CARRY_OVER_GROUPS만
function carriedSectionsFor(group) {
  const candidates = [
    ...(todayExisting ? [{ date, briefing: todayExisting }] : []),
    ...(CARRY_OVER_GROUPS.includes(group)
      ? previousDays.filter((p) => p.ago <= CARRY_OVER_LOOKBACK_DAYS)
      : []),
  ]
  const carried = carryOverSections(group, candidates, date)
  // 오늘 앞선 실행에서 이미 받아 둔 것을 그대로 쓰는 경우엔 오늘 데이터가 온전하다
  if (carried.length && carried.every((s) => !s.carriedFrom)) degraded.delete(group)
  return carried
}

function unavailableNotice(group) {
  const name = { reddit: 'Reddit', youtube: 'YouTube', steam: 'Steam', wikiChangelog: 'EFT 위키' }[group] ?? group
  const why = /HTTP 429/.test(failedGroups.get(group) ?? '') ? ' (요청 과다 HTTP 429)' : ''
  return {
    type: 'community',
    title: `${name} (오늘 수집 실패)`,
    items: [
      {
        title: `${name}에서 오늘 글을 가져오지 못했습니다${why}`,
        summary: '오늘 안에 자동으로 다시 시도합니다. 성공하면 이 자리에 오늘 글이 표시됩니다.',
      },
    ],
  }
}

function buildSections() {
  const sections = []
  const seenUrls = new Set() // 전역 중복 제거 — 같은 글이 여러 피드에 잡히는 일이 잦다
  const handledFailures = new Set()
  for (const plan of SECTION_PLAN) {
    if (failedGroups.has(plan.group)) {
      // 같은 그룹 섹션이 여러 개(Reddit 4개)라 한 번만 처리
      if (handledFailures.has(plan.group)) continue
      handledFailures.add(plan.group)
      const carried = carriedSectionsFor(plan.group)
      for (const s of carried) for (const i of s.items) if (i.url) seenUrls.add(i.url)
      if (carried.length) sections.push(...carried)
      else if (CARRY_OVER_GROUPS.includes(plan.group)) sections.push(unavailableNotice(plan.group))
      continue
    }
    let pool = (collected.sources[plan.group] ?? [])
      .filter((i) => i?.title)
      .filter((i) => !plan.feeds || plan.feeds.includes(i.feed))
    if (plan.type === 'videos') pool = dedupeVideos(pool, recentVideoIds)
    const items = pool
      .filter((i) => {
        if (!i.url) return true
        if (seenUrls.has(i.url)) return false
        seenUrls.add(i.url)
        return true
      })
      .slice(0, plan.max)
      .map((i) => {
        const summary = maskProfanity(excerptOf(i, plan.type))
        return {
          title: maskProfanity(String(i.title)),
          ...(summary ? { summary } : {}),
          ...(i.url ? { url: String(i.url) } : {}),
          ...(i.source ? { source: String(i.source) } : {}),
          ...(yesterdayUrls && i.url && !yesterdayUrls.has(i.url)
            ? { isNew: true }
            : {}),
        }
      })
    if (items.length) {
      sections.push({ type: plan.type, title: plan.title, items })
    }
  }
  return sections
}

// 헤드라인 — 패치 > 공식 소식 > 건수 요약 순. 없는 내용을 지어내지 않는 선에서
// "오늘 뭐가 들어왔는지"가 한 줄로 보이게 한다.
// 어제도 있던 패치를 매일 헤드라인으로 올리면 며칠씩 같은 줄이 박히므로,
// 새로 들어온 항목이 있을 때만 그 제목을 쓰고 아니면 건수 요약으로 넘어간다
function buildHeadline(sections) {
  const find = (title) => sections.find((s) => s.title === title)
  const freshOf = (section) =>
    section && (yesterdayUrls ? section.items.filter((i) => i.isNew) : section.items)

  for (const [title, label] of [
    ['패치노트 (EFT 위키)', '패치노트'],
    ['Steam 공식 소식', '공식 소식'],
  ]) {
    const fresh = freshOf(find(title))
    if (fresh?.length) {
      const rest = fresh.length - 1
      return `${fresh[0].title}${rest > 0 ? ` 외 ${label} ${rest}건` : ''}`
    }
  }
  const counts = []
  // 이어 붙인 지난 글(carriedFrom)·수집 실패 안내(source 없음)는 "오늘 들어온 소식"이 아니라 세지 않는다
  const todays = sections.filter((s) => !s.carriedFrom && s.items.some((i) => i.source))
  const warning = todays.filter((s) => s.type === 'warning')
  const reddit = todays.filter((s) => s.type === 'community' || s.type === 'tips')
  const videos = todays.find((s) => s.title === '신규 영상')
  const sum = (list) => list.reduce((n, s) => n + s.items.length, 0)
  if (warning.length) counts.push(`버그·이슈 ${sum(warning)}건`)
  if (reddit.length) counts.push(`커뮤니티 ${sum(reddit)}건`)
  if (videos) counts.push(`신규 영상 ${videos.items.length}건`)
  if (degraded.has('reddit')) counts.push('Reddit 수집 실패')
  return counts.length ? `오늘의 소식 — ${counts.join(' · ')}` : '오늘의 소식'
}

const sections = buildSections()

const briefing = sections.length
  ? { headline: buildHeadline(sections), sections }
  : {
      headline: '오늘은 수집된 새 소식이 없습니다',
      sections: [
        {
          type: 'news',
          title: '알림',
          items: [
            {
              title: '소식 수집 실패 또는 새 소식 없음',
              summary:
                '모든 소스에서 새 소식을 가져오지 못했습니다. 내일 다시 시도합니다.',
            },
          ],
        },
      ],
    }

// degraded: 통째로 실패해 오늘 데이터가 빠진 소스. daily-briefing.yml guard는 이 필드가 있으면
// 백업 cron에서 다시 수집한다 (없으면 "오늘 파일 있음 → skip")
const output = {
  date,
  generatedAt,
  ...briefing,
  ...(degraded.size ? { degraded: [...degraded] } : {}),
}
for (const [group, message] of failedGroups) {
  const how = !degraded.has(group)
    ? '오늘 앞선 실행의 데이터 유지'
    : CARRY_OVER_GROUPS.includes(group)
      ? '최근 브리핑 글 이어 싣기/실패 안내, degraded 표시'
      : '이 소스 섹션 없이 생성, degraded 표시'
  console.log(`  ⚠ ${group} 수집 실패 → ${how}: ${message}`)
}

// 내용이 오늘 파일과 같으면(generatedAt만 다름) 다시 쓰지 않는다 → 커밋·재배포 생략.
// degraded 날 백업 cron이 다시 돌아도 여전히 실패라면 파일이 그대로 남는다
const sameAsExisting =
  todayExisting &&
  JSON.stringify({ ...todayExisting, generatedAt: null }) ===
    JSON.stringify({ ...output, generatedAt: null })
await mkdir(OUTPUT_DIR, { recursive: true })
if (sameAsExisting) {
  console.log('오늘 파일과 내용이 같음 → 덮어쓰지 않음')
} else {
  await writeFile(
    path.join(OUTPUT_DIR, `${date}.json`),
    `${JSON.stringify(output, null, 2)}\n`,
  )
}

// index.json에 날짜 추가 (중복 제거, 최신순 정렬)
const indexPath = path.join(OUTPUT_DIR, 'index.json')
let dates = []
try {
  dates = JSON.parse(await readFile(indexPath, 'utf8')).dates ?? []
} catch {
  // index가 없거나 깨졌으면 새로 만든다
}
dates = [...new Set([date, ...dates])].sort().reverse()
await writeFile(indexPath, `${JSON.stringify({ dates })}\n`)

const itemCount = output.sections.reduce((n, s) => n + s.items.length, 0)
console.log(
  `브리핑 생성 완료 → ${OUTPUT_DIR}/${date}.json (섹션 ${output.sections.length}개, 항목 ${itemCount}개)`,
)
