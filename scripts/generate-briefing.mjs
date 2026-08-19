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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

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

// 어제 브리핑의 URL 집합 — isNew 판정 기준 (없으면 null → 아무 데도 isNew를 붙이지 않음)
async function loadYesterdayUrls() {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  const yDate = d.toISOString().slice(0, 10)
  try {
    const y = JSON.parse(
      await readFile(path.join(OUTPUT_DIR, `${yDate}.json`), 'utf8'),
    )
    const urls = new Set()
    for (const s of y.sections ?? []) {
      for (const i of s.items ?? []) if (i.url) urls.add(i.url)
    }
    return urls
  } catch {
    return null // 어제 파일 없음 (첫 실행·공백일)
  }
}

const yesterdayUrls = await loadYesterdayUrls()

function buildSections() {
  const sections = []
  const seenUrls = new Set() // 전역 중복 제거 — 같은 글이 여러 피드에 잡히는 일이 잦다
  for (const plan of SECTION_PLAN) {
    const pool = collected.sources[plan.group] ?? []
    const items = pool
      .filter((i) => i?.title)
      .filter((i) => !plan.feeds || plan.feeds.includes(i.feed))
      .filter((i) => {
        if (!i.url) return true
        if (seenUrls.has(i.url)) return false
        seenUrls.add(i.url)
        return true
      })
      .slice(0, plan.max)
      .map((i) => {
        const summary = excerptOf(i, plan.type)
        return {
          title: String(i.title),
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
  const warning = sections.filter((s) => s.type === 'warning')
  const reddit = sections.filter((s) => s.type === 'community' || s.type === 'tips')
  const videos = find('신규 영상')
  const sum = (list) => list.reduce((n, s) => n + s.items.length, 0)
  if (warning.length) counts.push(`버그·이슈 ${sum(warning)}건`)
  if (reddit.length) counts.push(`커뮤니티 ${sum(reddit)}건`)
  if (videos) counts.push(`신규 영상 ${videos.items.length}건`)
  return `오늘의 소식 — ${counts.join(' · ')}`
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

const output = { date, generatedAt, ...briefing }
await mkdir(OUTPUT_DIR, { recursive: true })
await writeFile(
  path.join(OUTPUT_DIR, `${date}.json`),
  `${JSON.stringify(output, null, 2)}\n`,
)

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
