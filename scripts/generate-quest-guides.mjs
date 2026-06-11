// 위키 퀘스트 가이드 AI 요약 백필 — 하루 30개씩, 전체 510개는 약 2~3주에 걸쳐 완성
// 스키마: docs/quest-guide-schema.md
//
// 흐름: 가이드 없는 퀘스트 선별 → 위키 Guide 섹션 추출(MediaWiki API)
//       → GitHub Models로 한국어 단계별 요약 → public/data/guides/{taskId}.json
// Guide 섹션이 없는 퀘스트는 skipped로 마킹해 재시도하지 않는다.
// 출처 표기: 위키 원문은 CC BY-SA — 각 가이드 JSON에 sourceUrl + license 필수.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { callWithFallback, getCallCount, MAX_CALLS } from './github-models.mjs'

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'public/data/guides'
const QUESTS_PER_RUN = Number(process.env.QUESTS_PER_RUN ?? 30)
const UA = 'tarkov-companion-guides/1.0 (github.com/MoriochoRadio/tarkov-companion)'
const token = process.env.GITHUB_TOKEN

if (!token) {
  console.error('GITHUB_TOKEN 없음 — 가이드 생성 불가')
  process.exit(1)
}

const generatedAt = new Date(Date.now() + 9 * 3600 * 1000)
  .toISOString()
  .replace('Z', '+09:00')

// ---------- 퀘스트 목록 (한/영 이름 + 위키 링크) ----------

const res = await fetch('https://api.tarkov.dev/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query:
      '{ ko: tasks(lang: ko) { id name wikiLink } en: tasks(lang: en) { id name } }',
  }),
  signal: AbortSignal.timeout(30_000),
})
const tasksJson = await res.json()
if (!tasksJson.data) throw new Error('tarkov.dev tasks 조회 실패')
const enName = new Map(tasksJson.data.en.map((t) => [t.id, t.name]))
const tasks = tasksJson.data.ko
  .filter((t) => t.wikiLink)
  .map((t) => ({
    id: t.id,
    nameKo: t.name.trim(),
    nameEn: (enName.get(t.id) ?? t.name).trim(),
    wikiLink: t.wikiLink,
  }))

// ---------- 진행 상태 (index.json) ----------

const indexPath = path.join(OUTPUT_DIR, 'index.json')
let index = { done: [], skipped: [] }
try {
  index = JSON.parse(await readFile(indexPath, 'utf8'))
} catch {
  // 첫 실행 — 새로 만든다
}
const processed = new Set([...index.done, ...index.skipped])
const candidates = tasks.filter((t) => !processed.has(t.id)).slice(0, QUESTS_PER_RUN)
console.log(
  `전체 ${tasks.length} / 완료 ${index.done.length} / 스킵 ${index.skipped.length} → 이번 실행 ${candidates.length}개`,
)
if (candidates.length === 0) {
  console.log('처리할 퀘스트 없음 — 백필 완료 상태')
  process.exit(0)
}

// ---------- 위키 Guide 섹션 추출 ----------

function cleanWikitext(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

async function fetchGuideSection(wikiLink) {
  const title = decodeURIComponent(wikiLink.split('/wiki/')[1] ?? '')
  if (!title) return null
  const api = `https://escapefromtarkov.fandom.com/api.php?action=parse&page=${encodeURIComponent(
    title,
  )}&prop=wikitext&format=json&formatversion=2`
  const r = await fetch(api, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  })
  if (!r.ok) throw new Error(`위키 HTTP ${r.status}`)
  const json = await r.json()
  const wikitext = json.parse?.wikitext
  if (!wikitext) return null
  const m = wikitext.match(/^==+\s*Guide\s*==+/im)
  if (!m) return null
  const rest = wikitext.slice(m.index + m[0].length)
  const next = rest.search(/\n==[^=]/) // 다음 레벨2 섹션 (마지막 섹션이면 끝까지)
  const cleaned = cleanWikitext(next >= 0 ? rest.slice(0, next) : rest)
  return cleaned.length >= 30 ? cleaned.slice(0, 4000) : null
}

// ---------- AI 요약 ----------

const SYSTEM_PROMPT = `너는 Escape From Tarkov 퀘스트 공략 번역·요약가다.
입력으로 퀘스트 이름과 영문 위키 Guide 원문을 받아, 한국어 단계별 공략을 만든다.

출력은 JSON 객체 하나:
{ "steps": ["1단계 내용", "2단계 내용", ...], "tips": "추가 팁 (선택, 없으면 생략)" }

규칙:
- 모든 텍스트는 한국어. 게임 용어·지명·아이템명은 "한국어 (English)" 병기 (예: "세관 (Customs)", "기숙사 (Dorms)")
- 원문에 있는 내용만 사용한다. 추측·창작 금지
- steps는 실제 진행 순서대로 2~8개, 각 1~3문장
- 좌표·키 이름·스폰 위치 같은 구체 정보는 빠뜨리지 말 것`

// ---------- 메인 루프 ----------

await mkdir(OUTPUT_DIR, { recursive: true })
let made = 0
let skipped = 0

for (const task of candidates) {
  if (getCallCount() >= MAX_CALLS) {
    console.log('호출 상한 도달 — 나머지는 내일 처리')
    break
  }
  try {
    const guideText = await fetchGuideSection(task.wikiLink)
    if (!guideText) {
      index.skipped.push(task.id)
      skipped += 1
      console.log(`- skip (Guide 섹션 없음): ${task.nameEn}`)
      continue
    }
    const result = await callWithFallback({
      system: SYSTEM_PROMPT,
      user: JSON.stringify({
        questKo: task.nameKo,
        questEn: task.nameEn,
        guide: guideText,
      }),
      token,
      purpose: `가이드(${task.nameEn.slice(0, 30)})`,
      validate: (parsed) => {
        const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
          .map((s) => String(s).trim())
          .filter(Boolean)
        if (steps.length === 0) throw new Error('steps가 비어 있음')
        return {
          steps,
          ...(parsed.tips ? { tips: String(parsed.tips) } : {}),
        }
      },
    })
    await writeFile(
      path.join(OUTPUT_DIR, `${task.id}.json`),
      `${JSON.stringify(
        {
          taskId: task.id,
          nameKo: task.nameKo,
          nameEn: task.nameEn,
          ...result,
          sourceUrl: task.wikiLink,
          license: 'CC BY-SA',
          generatedAt,
        },
        null,
        2,
      )}\n`,
    )
    index.done.push(task.id)
    made += 1
    console.log(`✓ ${task.nameEn} (${result.steps.length}단계)`)
  } catch (err) {
    // AI/네트워크 실패는 마킹하지 않음 → 다음 실행에서 재시도
    console.error(`✗ ${task.nameEn} 실패 (재시도 예정): ${err}`)
  }
  await sleep(1000) // 위키 레이트리밋 예방
}

index.done = [...new Set(index.done)]
index.skipped = [...new Set(index.skipped)]
await writeFile(indexPath, `${JSON.stringify(index)}\n`)
console.log(
  `가이드 ${made}개 생성, ${skipped}개 스킵 (누적: 완료 ${index.done.length} / 스킵 ${index.skipped.length} / 전체 ${tasks.length}, API 호출 ${getCallCount()}회)`,
)
