// 주간 메타 리포트: 지난주(월~일) 일일 브리핑을 종합해 "이번 주 정리" 생성
// 출력: public/data/weekly/<이번 주 월요일>.json + index.json (일일 브리핑과 같은 스키마 → 프런트 렌더러 공유)
// 매주 월요일 01:17 UTC(= KST 10:17, 백업 cron 2개)에 weekly-report.yml이 실행한다.
//
// 파일 날짜는 "실행한 날"이 아니라 "그 주(KST) 월요일"로 고정한다. 예전엔 KST 오늘 날짜를
// 썼는데, GitHub 스케줄이 몇 시간씩 밀려 월요일 백업 cron이 15:00 UTC(= KST 화요일 0시)를
// 넘기면 guard가 "오늘(화) 파일 없음"으로 보고 화요일자 리포트를 한 번 더 만들었다
// (2026-09-01·09-15·09-22·09-29 중복). 월요일로 고정하면 언제 돌아도 같은 파일이라
// guard(weekly-report.yml)와 함께 한 주에 하나만 남는다. 집계 범위도 지난주 월~일로 고정.
//
// AI 요약은 쓰지 않는다 (Phase 45). 대신 "며칠에 걸쳐 반복 등장했는가"를 중요도 신호로
// 삼는다 — 한 주 내내 올라온 이슈일수록 위로 올린다. 일일 브리핑을 이미 규칙으로
// 분류해 두었으므로(warning/news/tips/community) 주간은 그 축을 그대로 물려받는다.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { maskProfanity } from './mask-profanity.mjs'

const BRIEFINGS_DIR = process.env.BRIEFINGS_DIR ?? 'public/data/briefings'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'public/data/weekly'

// KST 기준 이번 주 월요일 (+9h 보정한 시각의 UTC 필드 = KST 달력)
const kstNow = new Date(Date.now() + 9 * 3600 * 1000)
const weekStartDate = new Date(kstNow)
weekStartDate.setUTCDate(kstNow.getUTCDate() - ((kstNow.getUTCDay() + 6) % 7)) // 월=0 … 일=6
const weekStart = weekStartDate.toISOString().slice(0, 10)
const generatedAt = kstNow.toISOString().replace('Z', '+09:00')

// 지난주 월~일 브리핑 로드
const index = JSON.parse(
  await readFile(path.join(BRIEFINGS_DIR, 'index.json'), 'utf8'),
)
const cutoff = new Date(`${weekStart}T00:00:00Z`)
cutoff.setUTCDate(cutoff.getUTCDate() - 7)
const weekDates = (index.dates ?? [])
  .filter((d) => d >= cutoff.toISOString().slice(0, 10) && d < weekStart)
  .sort()

const briefings = []
for (const d of weekDates) {
  try {
    briefings.push(
      JSON.parse(await readFile(path.join(BRIEFINGS_DIR, `${d}.json`), 'utf8')),
    )
  } catch (err) {
    console.error(`✗ ${d} 브리핑 로드 실패: ${err}`)
  }
}

if (briefings.length === 0) {
  console.error('지난 7일치 브리핑이 없음 — 주간 리포트 생성 생략')
  process.exit(0)
}
console.log(`지난 7일 브리핑 ${briefings.length}건 로드 (${weekDates.join(', ')})`)

// ---------- 집계 ----------

// 같은 글이 여러 날 브리핑에 실린다 → URL(없으면 제목) 기준으로 합치고 등장 일수를 센다.
// 등장 일수가 곧 "그 주 내내 화제였다"는 신호라 정렬 기준으로 쓴다.
const agg = new Map()
for (const b of briefings) {
  for (const s of b.sections ?? []) {
    for (const i of s.items ?? []) {
      if (!i?.title) continue
      const key = i.url ?? i.title
      const hit = agg.get(key)
      if (hit) {
        hit.days.add(b.date)
        // 요약은 더 긴 쪽을 남긴다 (날마다 발췌 길이가 다를 수 있음)
        if ((i.summary?.length ?? 0) > (hit.item.summary?.length ?? 0)) {
          hit.item = { ...hit.item, summary: maskProfanity(i.summary) }
        }
        continue
      }
      agg.set(key, {
        type: s.type,
        days: new Set([b.date]),
        item: {
          title: maskProfanity(i.title),
          ...(i.summary ? { summary: maskProfanity(i.summary) } : {}),
          ...(i.url ? { url: i.url } : {}),
          ...(i.source ? { source: i.source } : {}),
        },
      })
    }
  }
}

const entries = [...agg.values()].sort((a, b) => b.days.size - a.days.size)
const pick = (type, max) => entries.filter((e) => e.type === type).slice(0, max)
const plain = (list) => list.map((e) => e.item)

// 며칠 걸쳐 등장한 항목엔 그 사실을 붙인다 — 주간 리포트에서 가장 쓸모 있는 정보라
function withDays(list) {
  return list.map((e) => {
    if (e.days.size < 2) return e.item
    const note = `이번 주 ${e.days.size}일 등장`
    return {
      ...e.item,
      summary: e.item.summary ? `[${note}] ${e.item.summary}` : note,
    }
  })
}

const sections = []
const warnings = pick('warning', 6)
if (warnings.length) {
  sections.push({
    type: 'warning',
    title: '이번 주 누적 주의사항',
    items: withDays(warnings),
  })
}
const news = pick('news', 6)
if (news.length) {
  sections.push({ type: 'news', title: '이번 주 패치·공식 소식', items: plain(news) })
}
const tips = pick('tips', 5)
if (tips.length) {
  sections.push({ type: 'tips', title: '이번 주 공략·팁', items: withDays(tips) })
}
const community = pick('community', 6)
if (community.length) {
  // 여러 날 걸친 화제가 하나라도 있으면 그렇게 부르고, 아니면 그냥 인기 글 모음
  const repeated = community.filter((e) => e.days.size >= 2).length
  sections.push({
    type: 'community',
    title: repeated ? '여러 날 반복된 화제' : '이번 주 커뮤니티 인기 글',
    items: withDays(community),
  })
}

if (sections.length === 0) {
  console.error('집계할 항목이 없음 — 주간 리포트 생성 생략')
  process.exit(0)
}

const count = (type) =>
  sections.filter((s) => s.type === type).reduce((n, s) => n + s.items.length, 0)
const headlineParts = []
if (count('news')) headlineParts.push(`패치·공식 ${count('news')}건`)
if (count('warning')) headlineParts.push(`주의 ${count('warning')}건`)
if (count('tips')) headlineParts.push(`공략 ${count('tips')}건`)
if (count('community')) headlineParts.push(`화제 ${count('community')}건`)

const output = {
  date: weekStart,
  generatedAt,
  period: { from: weekDates[0], to: weekDates[weekDates.length - 1] },
  headline: `${weekDates[0]} ~ ${weekDates[weekDates.length - 1]} 주간 정리 — ${headlineParts.join(' · ')}`,
  sections,
}

await mkdir(OUTPUT_DIR, { recursive: true })
await writeFile(
  path.join(OUTPUT_DIR, `${weekStart}.json`),
  `${JSON.stringify(output, null, 2)}\n`,
)

const indexPath = path.join(OUTPUT_DIR, 'index.json')
let dates = []
try {
  dates = JSON.parse(await readFile(indexPath, 'utf8')).dates ?? []
} catch {
  // index가 없으면 새로 만든다
}
dates = [...new Set([weekStart, ...dates])].sort().reverse()
await writeFile(indexPath, `${JSON.stringify({ dates })}\n`)

const itemCount = sections.reduce((n, s) => n + s.items.length, 0)
console.log(
  `주간 리포트 생성 완료 → ${OUTPUT_DIR}/${weekStart}.json (섹션 ${sections.length}개, 항목 ${itemCount}개)`,
)
