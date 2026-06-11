// 주간 메타 리포트: 지난 7일치 일일 브리핑을 종합해 "이번 주 메타 정리" 생성
// 출력: public/data/weekly/<날짜>.json + index.json (일일 브리핑과 같은 스키마 → 프런트 렌더러 공유)
// 매주 월요일 01:00 UTC(= KST 10시)에 weekly-report.yml이 실행한다.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { callWithFallback, getCallCount } from './github-models.mjs'

const BRIEFINGS_DIR = process.env.BRIEFINGS_DIR ?? 'public/data/briefings'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'public/data/weekly'
const VALID_TYPES = new Set(['news', 'tips', 'community', 'warning', 'videos'])

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const generatedAt = new Date(Date.now() + 9 * 3600 * 1000)
  .toISOString()
  .replace('Z', '+09:00')
const token = process.env.GITHUB_TOKEN

// 지난 7일치 브리핑 로드
const index = JSON.parse(
  await readFile(path.join(BRIEFINGS_DIR, 'index.json'), 'utf8'),
)
const cutoff = new Date(`${today}T00:00:00Z`)
cutoff.setUTCDate(cutoff.getUTCDate() - 7)
const weekDates = (index.dates ?? [])
  .filter((d) => d >= cutoff.toISOString().slice(0, 10) && d < today)
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

const WEEKLY_PROMPT = `너는 Escape From Tarkov 한국어 주간 리포트의 편집장이다.
지난 7일치 일일 브리핑 모음을 받아 "이번 주 메타 정리"를 만든다.

출력은 JSON 객체 하나:
{
  "headline": "이번 주를 관통하는 한 줄 정리",
  "sections": [
    { "type": "news | tips | community | warning | videos", "title": "섹션 제목",
      "items": [{ "title": "...", "summary": "2~4문장", "url": "...", "source": "..." }] }
  ]
}

규칙:
- 일일 나열이 아니라 주간 흐름으로 묶는다: 패치 흐름, 메타 변화, 한 주 내내 반복된 이슈
- 여러 날 반복 등장한 주제일수록 중요하게 다룬다
- 일회성 소식은 과감히 버린다 (섹션당 최대 5개 항목)
- 다음 주에도 유효한 주의사항은 warning 섹션으로
- url/source는 입력에 있는 값만 사용. 모든 텍스트는 한국어`

function validateBriefing(parsed) {
  if (!parsed.headline || !Array.isArray(parsed.sections)) {
    throw new Error('headline/sections 누락')
  }
  const sections = parsed.sections
    .map((s) => ({
      type: VALID_TYPES.has(s.type) ? s.type : 'community',
      title: String(s.title ?? '').trim() || '기타',
      items: (Array.isArray(s.items) ? s.items : [])
        .filter((i) => i?.title && i?.summary)
        .slice(0, 5)
        .map((i) => ({
          title: String(i.title),
          summary: String(i.summary),
          ...(i.url ? { url: String(i.url) } : {}),
          ...(i.source ? { source: String(i.source) } : {}),
        })),
    }))
    .filter((s) => s.items.length > 0)
  if (sections.length === 0) throw new Error('유효한 섹션이 없음')
  return { headline: String(parsed.headline), sections }
}

// 폴백: 이번 주 warning + 각 날짜 헤드라인 모음
function buildFallback() {
  const warningItems = briefings.flatMap((b) =>
    (b.sections ?? [])
      .filter((s) => s.type === 'warning')
      .flatMap((s) => s.items ?? []),
  )
  const sections = [
    {
      type: 'news',
      title: '이번 주 일일 브리핑 헤드라인',
      items: briefings.map((b) => ({
        title: `${b.date}: ${b.headline}`,
        summary: '해당 날짜의 일일 브리핑을 참고하세요.',
      })),
    },
  ]
  if (warningItems.length > 0) {
    sections.unshift({
      type: 'warning',
      title: '이번 주 누적 주의사항',
      items: warningItems.slice(0, 5),
    })
  }
  return {
    headline: `${today} 주간 리포트 — AI 요약을 사용할 수 없어 헤드라인 모음으로 제공`,
    sections,
  }
}

let report = null
if (token) {
  try {
    report = await callWithFallback({
      system: WEEKLY_PROMPT,
      user: JSON.stringify(briefings),
      token,
      purpose: '주간 리포트',
      validate: validateBriefing,
    })
    console.log('✓ 주간 리포트 AI 요약 완료')
  } catch (err) {
    console.error(`✗ 주간 리포트 AI 실패 → 폴백: ${err}`)
  }
} else {
  console.error('GITHUB_TOKEN 없음 → 폴백 사용')
}
report ??= buildFallback()

const output = {
  date: today,
  generatedAt,
  period: { from: weekDates[0], to: weekDates[weekDates.length - 1] },
  ...report,
}
await mkdir(OUTPUT_DIR, { recursive: true })
await writeFile(
  path.join(OUTPUT_DIR, `${today}.json`),
  `${JSON.stringify(output, null, 2)}\n`,
)

const indexPath = path.join(OUTPUT_DIR, 'index.json')
let dates = []
try {
  dates = JSON.parse(await readFile(indexPath, 'utf8')).dates ?? []
} catch {
  // index가 없으면 새로 만든다
}
dates = [...new Set([today, ...dates])].sort().reverse()
await writeFile(indexPath, `${JSON.stringify({ dates })}\n`)

console.log(
  `주간 리포트 생성 완료 → ${OUTPUT_DIR}/${today}.json (API 호출 ${getCallCount()}회)`,
)
