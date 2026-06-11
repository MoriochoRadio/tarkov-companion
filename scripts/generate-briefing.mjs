// 일일 브리핑 2단계: AI 요약 → 스키마(docs/briefing-schema.md) JSON 생성
// 입력: tmp/collected.json (collect-briefing.mjs 출력)
// 출력: public/data/briefings/<날짜>.json + index.json 갱신
//
// 2패스 구조:
//   1차 "기자" — 소스 그룹별로 각각 요약 (그룹당 1회 호출)
//   2차 "편집장" — 통합·중복 제거·중요도 랭킹·섹션 분류.
//        어제 브리핑을 컨텍스트로 줘서 새 이슈에 isNew: true 표시
// 어느 단계가 실패해도 남은 재료로 브리핑을 만들어 절대 빈 날이 없게 한다.
// 호출 횟수는 github-models.mjs가 로깅하며 상한 20회에서 차단된다.
// (평소 사용량: 기자 ≤4회 + 편집장 1회 = 하루 ≤5회)
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { callWithFallback, getCallCount } from './github-models.mjs'

// 로컬 테스트 시 실제 데이터를 건드리지 않도록 OUTPUT_DIR로 출력 경로 변경 가능
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'public/data/briefings'
const VALID_TYPES = new Set(['news', 'tips', 'community', 'warning', 'videos'])

const collected = JSON.parse(await readFile('tmp/collected.json', 'utf8'))
const date = collected.date
// toISOString은 UTC(Z) 표기라서, +9h 보정한 시각에 +09:00을 붙여 KST로 표현
const generatedAt = new Date(Date.now() + 9 * 3600 * 1000)
  .toISOString()
  .replace('Z', '+09:00')
const token = process.env.GITHUB_TOKEN

// ---------- 공통 검증 ----------

// summary는 선택 — 영상처럼 요약할 내용이 없는 항목은 제목+출처만 남긴다
function validateItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((i) => i?.title)
    .map((i) => ({
      title: String(i.title),
      ...(i.summary ? { summary: String(i.summary) } : {}),
      ...(i.url ? { url: String(i.url) } : {}),
      ...(i.source ? { source: String(i.source) } : {}),
      ...(i.isNew === true ? { isNew: true } : {}),
    }))
}

function validateBriefing(parsed) {
  if (!parsed.headline || !Array.isArray(parsed.sections)) {
    throw new Error('headline/sections 누락')
  }
  const sections = parsed.sections
    .map((s) => ({
      type: VALID_TYPES.has(s.type) ? s.type : 'community',
      title: String(s.title ?? '').trim() || '기타',
      items: validateItems(s.items),
    }))
    .filter((s) => s.items.length > 0)
  if (sections.length === 0) throw new Error('유효한 섹션이 없음')
  return { headline: String(parsed.headline), sections }
}

// ---------- 1차: 기자 패스 (소스 그룹별 요약) ----------

const REPORTER_RULES = `출력은 JSON 객체 하나: { "items": [{ "title": "한국어 제목", "summary": "1~3문장 한국어 요약", "url": "...", "source": "..." }] }
- url과 source는 입력에 있는 값만 사용한다. 절대 지어내지 않는다
- 중요하지 않은 항목은 버려도 된다 (최대 8개)
- 모든 텍스트는 한국어. 고유명사는 원어 유지 가능`

const REPORTER_PROMPTS = {
  wikiChangelog: `너는 Escape From Tarkov 패치노트 담당 기자다. 위키 체인지로그 원문에서 플레이어에게 영향이 큰 변경을 골라 요약한다. 너프·버그·사망 위험 항목은 summary 앞에 [주의]를 붙인다.\n${REPORTER_RULES}`,
  reddit: `너는 Escape From Tarkov 커뮤니티 담당 기자다. Reddit 글 목록(피드별: 인기글/버그·이슈/공략)에서 의미 있는 동향을 골라 요약한다. 비슷한 글은 하나로 묶고(url은 대표 글), 버그·이슈 제보는 summary 앞에 [주의]를 붙인다. 단순 짤·자랑글은 버린다.\n${REPORTER_RULES}`,
  youtube: `너는 Escape From Tarkov 영상 담당 기자다. 최근 24시간 신규 영상 목록을 정리한다. 제목만으로 판단하고 영상 내용을 추측하지 않는다. summary는 쓰지 말 것 — 제목에 없는 정보를 만들 수 없기 때문이다. 항목은 title/url/source만 채우고, 한국 채널 영상을 앞에 배치한다.\n${REPORTER_RULES}`,
  steam: `너는 Escape From Tarkov 공식 소식 담당 기자다. Steam 뉴스 피드에서 공지·이벤트·패치 소식을 요약한다.\n${REPORTER_RULES}`,
}

async function reporterPass() {
  const reports = {}
  for (const [group, items] of Object.entries(collected.sources)) {
    if (!items?.length) continue
    const system = REPORTER_PROMPTS[group]
    if (!system) {
      // 프롬프트가 없는 새 그룹은 원자료 그대로 편집장에게
      reports[group] = { raw: true, items }
      continue
    }
    try {
      reports[group] = await callWithFallback({
        system,
        user: JSON.stringify(items),
        token,
        purpose: `기자(${group})`,
        validate: (parsed) => {
          const validated = validateItems(parsed.items)
          if (validated.length === 0) throw new Error('기자 출력이 비어 있음')
          return { items: validated }
        },
      })
    } catch (err) {
      console.error(`✗ 기자(${group}) 전체 실패 → 원자료로 대체: ${err}`)
      reports[group] = { raw: true, items }
    }
  }
  return reports
}

// ---------- 2차: 편집장 패스 (통합 + isNew 판정) ----------

const EDITOR_PROMPT = `너는 Escape From Tarkov 한국어 일일 브리핑의 편집장이다.
기자들이 보낸 그룹별 요약(reports)과 어제 브리핑(yesterday, 없으면 null)을 받아 오늘의 최종 브리핑을 만든다.

출력은 JSON 객체 하나:
{
  "headline": "오늘 가장 중요한 내용 한 줄",
  "sections": [
    { "type": "news | tips | community | warning | videos", "title": "섹션 제목",
      "items": [{ "title": "...", "summary": "2~3문장", "url": "...", "source": "...", "isNew": true }] }
  ]
}

규칙:
- 그룹을 넘나드는 중복(같은 사건을 위키·Reddit·Steam이 각각 다룸)은 하나로 합치고 가장 좋은 출처 하나를 남긴다
- 중요한 것부터: 섹션 안에서 플레이어 영향이 큰 항목을 위로
- 너프·버그·사망 위험 등 손해 볼 수 있는 내용은 반드시 type "warning" 섹션으로 분리
- 유튜브 영상은 type "videos" 섹션으로. 영상 항목에는 summary를 쓰지 않는다 ("채널 X가 영상을 올렸다" 같은 무의미한 문장 금지). 제목에서 알 수 없는 내용을 지어내지 말 것
- videos 외 섹션에서도 덧붙일 정보가 정말 없으면 summary를 생략해도 된다
- yesterday에 같은 내용이 이미 있으면 isNew를 생략하고, 어제 없던 새 이슈에만 isNew: true
- yesterday가 null이면 isNew를 아무 데도 붙이지 않는다
- url/source는 입력에 있는 값만 사용. 내용 없는 섹션은 만들지 않는다
- 모든 텍스트는 한국어`

async function editorPass(reports, yesterday) {
  return callWithFallback({
    system: EDITOR_PROMPT,
    user: JSON.stringify({ reports, yesterday }),
    token,
    purpose: '편집장(통합)',
    validate: validateBriefing,
  })
}

// 어제 브리핑 로드 (없으면 null) — 편집장의 isNew 판정 기준
async function loadYesterday() {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  const yDate = d.toISOString().slice(0, 10)
  try {
    const y = JSON.parse(
      await readFile(path.join(OUTPUT_DIR, `${yDate}.json`), 'utf8'),
    )
    // 프롬프트를 가볍게 유지 — 판정에 필요한 제목·요약만 추림
    return {
      date: y.date,
      headline: y.headline,
      sections: (y.sections ?? []).map((s) => ({
        type: s.type,
        items: (s.items ?? []).map((i) => ({ title: i.title, summary: i.summary })),
      })),
    }
  } catch {
    return null
  }
}

// ---------- 폴백: AI 없이 수집/기자 결과를 그대로 브리핑화 ----------

const GROUP_FALLBACK_SECTIONS = {
  wikiChangelog: { type: 'news', title: '패치노트 (EFT 위키)' },
  steam: { type: 'news', title: 'Steam 공식 소식' },
  reddit: { type: 'community', title: 'Reddit 커뮤니티' },
  youtube: { type: 'videos', title: '신규 영상' },
}

function buildFallback(reports) {
  const sections = []
  for (const [group, meta] of Object.entries(GROUP_FALLBACK_SECTIONS)) {
    const report = reports?.[group] ?? { raw: true, items: collected.sources[group] }
    const items = report?.items
    if (!items?.length) continue
    sections.push({
      type: meta.type,
      title: meta.title,
      items: items.slice(0, 8).map((i) => {
        // 영상은 제목이 전부라 폴백에서도 summary를 만들지 않는다
        const summary =
          meta.type === 'videos'
            ? null
            : (i.summary ?? (i.content ?? '').slice(0, 300) ?? null) || null
        return {
          title: i.title,
          ...(summary ? { summary } : {}),
          ...(i.url ? { url: i.url } : {}),
          ...(i.source ? { source: i.source } : {}),
        }
      }),
    })
  }
  if (sections.length === 0) {
    return {
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
  }
  return {
    headline: `${date} 브리핑 — AI 통합 요약을 사용할 수 없어 그룹별 정리로 제공`,
    sections,
  }
}

// ---------- 메인 ----------

let briefing = null
let reports = null
const hasData = Object.values(collected.sources).some((arr) => arr?.length)

if (!token) {
  console.error('GITHUB_TOKEN 없음 → 폴백 사용')
} else if (!hasData) {
  console.error('수집된 데이터 없음 → 폴백 사용')
} else {
  reports = await reporterPass()
  try {
    briefing = await editorPass(reports, await loadYesterday())
    console.log('✓ 편집장 통합 완료')
  } catch (err) {
    console.error(`✗ 편집장 실패 → 폴백: ${err}`)
  }
}

briefing ??= buildFallback(reports)

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

console.log(
  `브리핑 생성 완료 → ${OUTPUT_DIR}/${date}.json (섹션 ${output.sections.length}개, API 호출 ${getCallCount()}회)`,
)
