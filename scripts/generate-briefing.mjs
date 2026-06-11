// 일일 브리핑 2단계: GitHub Models로 한국어 요약 → 스키마(docs/briefing-schema.md) JSON 생성
// 입력: tmp/collected.json (collect-briefing.mjs 출력)
// 출력: public/data/briefings/<날짜>.json + index.json 갱신
//
// AI 호출이 실패해도 제목+링크 목록으로 브리핑을 만들어 절대 빈 날이 없게 한다.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// 로컬 테스트 시 실제 데이터를 건드리지 않도록 OUTPUT_DIR로 출력 경로 변경 가능
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'public/data/briefings'
// 1순위 실패(미지원/한도 초과) 시 다음 모델로 넘어감
const MODELS = ['openai/gpt-4.1-mini', 'openai/gpt-4o-mini']
const VALID_TYPES = new Set(['news', 'tips', 'community', 'warning'])

const collected = JSON.parse(await readFile('tmp/collected.json', 'utf8'))
const date = collected.date
// toISOString은 UTC(Z) 표기라서, +9h 보정한 시각에 +09:00을 붙여 KST로 표현
const generatedAt =
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00')

const SYSTEM_PROMPT = `너는 Escape From Tarkov 플레이어를 위한 한국어 일일 브리핑 작성자다.
입력으로 주어진 수집 데이터만 사용해 아래 스키마의 JSON 객체 하나만 출력한다.

스키마:
{
  "headline": "오늘 가장 중요한 내용 한 줄 요약",
  "sections": [
    {
      "type": "news | tips | community | warning",
      "title": "섹션 제목 (한국어)",
      "items": [
        { "title": "제목(한국어)", "summary": "2~3문장 한국어 요약", "url": "출처 링크", "source": "출처 이름" }
      ]
    }
  ]
}

규칙:
- 모든 텍스트는 한국어로 쓴다. 아이템·보스·맵 이름 등 고유명사는 원어를 그대로 써도 된다
- url과 source는 입력 데이터에 있는 값만 사용한다. 절대 지어내지 않는다
- 패치노트는 type "news", 공략이 될 만한 내용은 "tips", Reddit 글 동향은 "community"
- 너프·버그·사망 위험 등 플레이어가 손해 볼 수 있는 내용은 반드시 type "warning" 섹션으로 분리한다
- 입력에 해당 내용이 없는 섹션은 만들지 않는다
- Reddit 글은 비슷한 주제끼리 묶어 동향으로 요약해도 된다 (이때 url은 대표 글 하나)`

async function callModel(model, token) {
  const res = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(collected.sources) },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  return data.choices[0].message.content
}

// AI 출력 검증 — 깨진 JSON이나 스키마 불일치면 throw → 폴백으로
function parseAndValidate(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/```\s*$/, '')
  const parsed = JSON.parse(cleaned)
  if (!parsed.headline || !Array.isArray(parsed.sections)) {
    throw new Error('headline/sections 누락')
  }
  const sections = parsed.sections
    .map((s) => ({
      type: VALID_TYPES.has(s.type) ? s.type : 'community',
      title: String(s.title ?? '').trim() || '기타',
      items: (Array.isArray(s.items) ? s.items : [])
        .filter((i) => i?.title && i?.summary)
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

// 폴백: AI 없이 수집 결과를 제목+링크 위주로 그대로 브리핑화
function buildFallback() {
  const sections = []
  const wiki = collected.sources.wikiChangelog
  if (wiki?.length) {
    sections.push({
      type: 'news',
      title: '패치노트 (EFT 위키)',
      items: wiki.map((i) => ({
        title: i.title,
        summary: (i.content ?? '').slice(0, 300) || '원문 링크를 참고하세요.',
        url: i.url,
        source: i.source,
      })),
    })
  }
  const reddit = collected.sources.reddit
  if (reddit?.length) {
    sections.push({
      type: 'community',
      title: 'Reddit 일간 인기글',
      items: reddit.map((i) => ({
        title: i.title,
        summary: 'AI 요약 없이 수집된 글입니다. 원문 링크를 참고하세요.',
        url: i.url,
        source: i.source,
      })),
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
    headline: `${date} 브리핑 — AI 요약을 사용할 수 없어 출처 링크 위주로 제공`,
    sections,
  }
}

let briefing = null
const token = process.env.GITHUB_TOKEN
const hasData = Object.values(collected.sources).some((arr) => arr?.length)

if (!token) {
  console.error('GITHUB_TOKEN 없음 → 폴백 사용')
} else if (!hasData) {
  console.error('수집된 데이터 없음 → 폴백 사용')
} else {
  for (const model of MODELS) {
    try {
      briefing = parseAndValidate(await callModel(model, token))
      console.log(`✓ AI 요약 성공 (${model})`)
      break
    } catch (err) {
      console.error(`✗ ${model} 실패: ${err}`)
    }
  }
}

briefing ??= buildFallback()

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
  `브리핑 생성 완료 → ${OUTPUT_DIR}/${date}.json (섹션 ${output.sections.length}개, 헤드라인: ${output.headline})`,
)
