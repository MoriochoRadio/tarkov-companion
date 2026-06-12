// 위키 퀘스트 가이드 AI 백필 — 하루 30개씩, 전체 510개는 약 2~3주에 걸쳐 완성
// 스키마: docs/quest-guide-schema.md
//
// v2 (Phase 22): 요약 → "충실한 상세 공략"으로 격상. 위치·루트·키 이름·입수처를
// 빠뜨리지 않는 번역 수준 + 위키 위치 스크린샷 핫링크(images). 기존 v1 파일은
// 신규 퀘스트를 먼저 처리한 뒤 차례로 다시 생성한다 (version 필드로 구분).
//
// 흐름: 대상 퀘스트 선별 → 위키 Guide 섹션 추출(MediaWiki API)
//       → GitHub Models로 한국어 상세 공략 → public/data/guides/{taskId}.json
// Guide 섹션이 없는 퀘스트는 skipped로 마킹해 재시도하지 않는다.
// 출처 표기: 위키 원문은 CC BY-SA — 각 가이드 JSON에 sourceUrl + license 필수.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { callWithFallback, getCallCount, MAX_CALLS } from './github-models.mjs'
import { extractImageRefs, resolveImageUrls } from './wiki-images.mjs'

const GUIDE_VERSION = 2

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
// 가이드 파일의 version을 읽어 "아직 없음"과 "v1 → 재생성 대상"을 구분
async function fileVersion(taskId) {
  try {
    const json = JSON.parse(await readFile(path.join(OUTPUT_DIR, `${taskId}.json`), 'utf8'))
    return json.version ?? 1
  } catch {
    return 0 // 파일 없음
  }
}

const skippedSet = new Set(index.skipped)
const fresh = [] // 가이드가 아예 없는 퀘스트 — 우선 처리
const outdated = [] // v1 가이드 — 신규를 다 채운 뒤 상세판으로 재생성
for (const t of tasks) {
  if (skippedSet.has(t.id)) continue
  const v = await fileVersion(t.id)
  if (v === 0) fresh.push(t)
  else if (v < GUIDE_VERSION) outdated.push(t)
}
const candidates = [...fresh, ...outdated].slice(0, QUESTS_PER_RUN)
console.log(
  `전체 ${tasks.length} / 신규 ${fresh.length} / v1 재생성 대기 ${outdated.length} / 스킵 ${index.skipped.length} → 이번 실행 ${candidates.length}개`,
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
  const raw = next >= 0 ? rest.slice(0, next) : rest
  const cleaned = cleanWikitext(raw)
  if (cleaned.length < 30) return null
  // 위치 스크린샷·지도 마킹 — 본문 정리 전 원문에서 추출 (URL은 나중에 일괄 해석)
  return { text: cleaned.slice(0, 8000), imageRefs: extractImageRefs(raw) }
}

// ---------- AI 요약 ----------

const SYSTEM_PROMPT = `너는 Escape From Tarkov 퀘스트 공략 전문 번역가다.
입력으로 퀘스트 이름과 영문 위키 Guide 원문을 받아, 한국어 상세 공략을 만든다.

출력은 JSON 객체 하나:
{ "steps": ["...", "...", ...], "tips": "추가 팁 (선택, 없으면 생략)", "captions": ["이미지 캡션 번역", ...] }

- steps 각 항목에 "1단계:", "2." 같은 번호를 붙이지 말 것 (화면이 번호를 자동으로 매김)
- 입력에 imageCaptions 배열이 있으면 같은 길이·순서로 한국어 번역해 captions로 반환

규칙:
- 요약하지 말 것. 원문의 정보(목표물 위치 설명, 가는 루트, 필요한 열쇠·키카드 이름,
  층·방 번호, 수량, 아이템 입수처)를 하나도 빠뜨리지 말고 전부 담는다
- 원문에 있는 내용만 사용한다. 추측·창작 금지
- 제출 아이템이 나오면 원문에 적힌 입수 방법(플리마켓·트레이더 구매 가능 여부,
  잘 나오는 맵·장소, found in raid 필요 여부)을 반드시 포함
- steps는 실제 진행 순서대로 2~12개. 한 단계 안에서 위치·경로를 구체적으로 설명
  (예: "기숙사 3층 314호 — 마킹된 열쇠 필요, 정문 계단으로 올라가 왼쪽 복도 끝")
- 모든 텍스트는 자연스러운 한국어. 고유명사는 "한국어 (English)" 병기
- 맵 이름 표준: Customs=세관, Woods=삼림, Shoreline=해안선, Interchange=인터체인지,
  Reserve=리저브, Lighthouse=등대, Factory=공장, Streets of Tarkov=타르코프 시내,
  Ground Zero=그라운드 제로, The Lab=연구소, The Labyrinth=미궁
- 트레이더 표준: Prapor=프라퍼, Therapist=테라피스트, Skier=스키어, Peacekeeper=피스키퍼,
  Mechanic=메카닉, Ragman=래그맨, Jaeger=예거, Fence=펜스, Lightkeeper=등대지기
- found in raid = "레이드 획득(FIR)"`

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
    const guide = await fetchGuideSection(task.wikiLink)
    if (!guide) {
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
        guide: guide.text,
        imageCaptions: guide.imageRefs.map((r) => r.caption),
      }),
      token,
      purpose: `가이드(${task.nameEn.slice(0, 30)})`,
      validate: (parsed) => {
        const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
          .map((s) => String(s).trim().replace(/^(?:\d+\s*단계|\d+)\s*[:.)]\s*/, ''))
          .filter(Boolean)
        if (steps.length === 0) throw new Error('steps가 비어 있음')
        return {
          steps,
          ...(parsed.tips ? { tips: String(parsed.tips) } : {}),
          captions: Array.isArray(parsed.captions) ? parsed.captions.map(String) : [],
        }
      },
    })
    // 위치 스크린샷 URL 해석 — 실패해도 텍스트 가이드는 살린다
    const { captions, ...guideBody } = result
    let images = []
    try {
      const urlMap = await resolveImageUrls(guide.imageRefs.map((r) => r.file))
      images = guide.imageRefs
        .map((r, i) => ({
          url: urlMap.get(r.file) ?? null,
          // AI가 번역한 캡션 우선, 길이 안 맞으면 영어 원문 폴백
          caption: String(captions?.[i] ?? r.caption ?? '').trim(),
        }))
        .filter((img) => img.url)
        .slice(0, 12)
    } catch (err) {
      console.warn(`  ⚠ 이미지 해석 실패 (${task.nameEn}): ${err}`)
    }
    await writeFile(
      path.join(OUTPUT_DIR, `${task.id}.json`),
      `${JSON.stringify(
        {
          version: GUIDE_VERSION,
          taskId: task.id,
          nameKo: task.nameKo,
          nameEn: task.nameEn,
          ...guideBody,
          ...(images.length ? { images } : {}),
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
    console.log(`✓ ${task.nameEn} (${result.steps.length}단계, 이미지 ${images.length}장)`)
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
