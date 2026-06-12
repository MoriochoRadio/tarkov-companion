// 스토리 챕터 공략 한국어화 — EFT 위키 Guide 섹션을 "요약이 아니라 충실 번역"으로
// 옮겨 public/data/story-guides/{slug}.json 생성. 위치 스크린샷·지도 마킹 이미지는
// 위키 CDN URL을 핫링크(출처 표기). 챕터당 섹션을 ~5.5KB 묶음으로 나눠 호출하므로
// 전체 10챕터 ≈ 20~30회 — 한 번의 워크플로 실행(상한 30회)으로 대부분 끝남.
// 남으면 다음 실행이 이어서 처리. 진행 상태: story-guides/index.json
//
// 위키가 크게 바뀌면: workflow_dispatch 입력 redo=슬러그(또는 all)로 재생성
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { callWithFallback, getCallCount, MAX_CALLS } from './github-models.mjs'
import { extractImageRefs, resolveImageUrls } from './wiki-images.mjs'

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'public/data/story-guides'
const STORYLINE = process.env.STORYLINE_PATH ?? 'public/data/storyline.json'
const UA = 'tarkov-companion-guides/1.0 (github.com/MoriochoRadio/tarkov-companion)'
const CHUNK_CHARS = 5500
const token = process.env.GITHUB_TOKEN

if (!token) {
  console.error('GITHUB_TOKEN 없음 — 생성 불가')
  process.exit(1)
}

const generatedAt = new Date(Date.now() + 9 * 3600 * 1000)
  .toISOString()
  .replace('Z', '+09:00')

// ---------- 위키 파싱 ----------

async function fetchWikitext(title) {
  const url = `https://escapefromtarkov.fandom.com/api.php?${new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
  })}`
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    })
    if (r.ok) return (await r.json()).parse?.wikitext ?? null
    if (attempt >= 3) throw new Error(`위키 HTTP ${r.status} (${title})`)
    await sleep(attempt * 3000)
  }
}

function guideSection(wikitext) {
  const m = wikitext.match(/^==+\s*Guide\s*==+/im)
  if (!m) return null
  const rest = wikitext.slice(m.index + m[0].length)
  const next = rest.search(/\n==[^=]/)
  return next >= 0 ? rest.slice(0, next) : rest
}

// 위키테이블 → 읽을 수 있는 줄 목록 ("- 셀1 · 셀2 …")
function tableToLines(block) {
  // 셀 안의 File 링크를 먼저 제거 — 남겨두면 아래 style 접두사 제거가
  // "[[File:x.png|"까지 먹어서 "link=…]]" 찌꺼기가 남는다 (실측)
  block = block.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
  const rows = []
  let cells = []
  for (const raw of block.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('{|') || line.startsWith('|}')) continue
    if (line.startsWith('|-')) {
      if (cells.length) rows.push(cells)
      cells = []
      continue
    }
    if (line.startsWith('!') || line.startsWith('|')) {
      // "! a !! b" / "| a || b" — 한 줄 다중 셀 지원
      for (const cell of line.slice(1).split(/\|\||!!/)) {
        const c = cell.replace(/^[^|]*\|(?!\|)/, '').trim() // style="..."| 제거
        if (c) cells.push(c)
      }
    }
  }
  if (cells.length) rows.push(cells)
  return rows.map((r) => `- ${r.join(' · ')}`).join('\n')
}

function cleanBody(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\|[\s\S]*?\|\}/g, (b) => `\n${tableToLines(b)}\n`)
    .replace(/<gallery[^>]*>[\s\S]*?<\/gallery>/gi, '')
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/^====\s*(.*?)\s*====$/gm, '[$1]')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{PAGENAME\}\}/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripTitle(s) {
  return cleanBody(s).trim()
}

// Guide 섹션 → [{titleEn, bodyEn, imageRefs}] (===하위 섹션=== 단위)
function splitSections(guide) {
  const out = []
  const parts = guide.split(/^===([^=].*?)===\s*$/m)
  // parts[0] = 첫 하위 섹션 이전의 도입부, 이후 [제목, 본문] 반복
  const push = (titleEn, raw) => {
    const bodyEn = cleanBody(raw)
    const imageRefs = extractImageRefs(raw)
    if (!bodyEn && imageRefs.length === 0) return
    out.push({ titleEn, bodyEn, imageRefs })
  }
  if (parts[0]?.trim()) push('Overview', parts[0])
  for (let i = 1; i < parts.length; i += 2) {
    push(stripTitle(parts[i]), parts[i + 1] ?? '')
  }
  return out
}

// ---------- AI 번역 ----------

const SYSTEM_PROMPT = `너는 Escape From Tarkov 공략 전문 번역가다. 영문 위키 공략을 한국어로 옮긴다.

입력: { "chapter": "챕터명", "sections": [{ "i": 번호, "title": "...", "body": "...", "captions": ["이미지 캡션", ...] }, ...] }
출력: 같은 구조의 JSON — { "sections": [{ "i": 같은 번호, "title": "한국어 제목", "body": "한국어 본문", "captions": ["한국어 캡션", ...] }, ...] }

규칙:
- 요약 금지. 원문의 정보(위치 설명, 이동 경로, 열쇠·키카드 이름, 좌표, 수량, 조건, 보상)를 하나도 빠뜨리지 말고 전부 옮긴다
- 자연스러운 한국어로. 직역투 대신 공략글 어조 ("~하면 됩니다", "~에 있습니다")
- 고유명사(맵·트레이더·아이템·장소)는 "한국어 (English)" 병기. 단, 같은 섹션에서 두 번째부터는 한국어만
- 맵 이름 표준: Customs=세관, Woods=삼림, Shoreline=해안선, Interchange=인터체인지, Reserve=리저브, Lighthouse=등대, Factory=공장, Streets of Tarkov=타르코프 시내, Ground Zero=그라운드 제로, The Lab=연구소, The Labyrinth=미궁, Terminal=터미널, Icebreaker=쇄빙선, Health Resort=보양소
- 트레이더 표준: Prapor=프라퍼, Therapist=테라피스트, Skier=스키어, Peacekeeper=피스키퍼, Mechanic=메카닉, Ragman=래그맨, Jaeger=예거, Fence=펜스, Lightkeeper=등대지기, BTR Driver=BTR 운전병, Mr. Kerman=Mr. 케르만
- found in raid = "레이드 획득(FIR)", extract = "탈출", Run-Through = "런스루(통과)"
- body 안의 "- " 목록 줄과 "[제목]" 줄(소제목)은 형식을 유지한 채 내용만 번역
- 표에서 온 줄(아이템 · 수량 · 조건)도 같은 "- " 형식으로 번역
- captions 배열은 입력과 같은 길이·순서로 번역`

function chunkSections(sections) {
  const chunks = []
  let cur = []
  let size = 0
  for (const s of sections) {
    const len = s.bodyEn.length + 100
    if (cur.length > 0 && size + len > CHUNK_CHARS) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(s)
    size += len
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

// ---------- 메인 ----------

const storyline = JSON.parse(await readFile(STORYLINE, 'utf8'))
const chapters = storyline.chapters.map((c) => ({
  slug: c.slug,
  nameKo: c.nameKo,
  nameEn: c.nameEn,
  wikiUrl: c.wikiUrl,
  title: decodeURIComponent(c.wikiUrl.split('/wiki/')[1]).replace(/_/g, ' '),
}))

const indexPath = path.join(OUTPUT_DIR, 'index.json')
let index = { done: [] }
try {
  index = JSON.parse(await readFile(indexPath, 'utf8'))
} catch {
  // 첫 실행
}
// redo 입력: 슬러그 하나 또는 'all' — 해당 챕터를 다시 만든다
const redo = (process.env.REDO ?? '').trim()
if (redo === 'all') index.done = []
else if (redo) index.done = index.done.filter((s) => s !== redo)

const pending = chapters.filter((c) => !index.done.includes(c.slug))
console.log(`챕터 ${chapters.length}개 중 미처리 ${pending.length}개`)
await mkdir(OUTPUT_DIR, { recursive: true })

for (const ch of pending) {
  try {
    const wikitext = await fetchWikitext(ch.title)
    const guide = wikitext ? guideSection(wikitext) : null
    if (!guide) {
      console.log(`- skip (Guide 섹션 없음): ${ch.slug}`)
      continue
    }
    const sections = splitSections(guide)
    const chunks = chunkSections(sections)
    if (getCallCount() + chunks.length > MAX_CALLS) {
      console.log(`호출 예산 부족 (${ch.slug}: ${chunks.length}회 필요) — 다음 실행에서 처리`)
      break
    }

    // 이미지 URL 일괄 해석
    const allFiles = sections.flatMap((s) => s.imageRefs.map((r) => r.file))
    const urlMap = await resolveImageUrls(allFiles)

    // 청크별 번역 — 섹션 전역 인덱스로 응답을 재배치
    const translated = new Array(sections.length).fill(null)
    for (const chunk of chunks) {
      const payload = {
        chapter: `${ch.nameEn} (스토리 챕터)`,
        sections: chunk.map((s) => ({
          i: sections.indexOf(s),
          title: s.titleEn,
          body: s.bodyEn,
          captions: s.imageRefs.map((r) => r.caption),
        })),
      }
      // 무료 한도는 분당 제한이 따로 있어 연속 호출 시 429 — 한 번은 쉬었다 재시도
      let result = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          result = await callWithFallback({
            system: SYSTEM_PROMPT,
            user: JSON.stringify(payload),
            token,
            purpose: `스토리 공략(${ch.slug} ${chunk.length}섹션)`,
            validate: (parsed) => {
              if (!Array.isArray(parsed.sections)) throw new Error('sections 배열 아님')
              return parsed.sections
            },
          })
          break
        } catch (err) {
          if (attempt >= 2) throw err
          console.warn(`  429/실패 — 40초 대기 후 재시도`)
          await sleep(40_000)
        }
      }
      for (const r of result) {
        if (typeof r?.i === 'number' && r.i >= 0 && r.i < sections.length) {
          translated[r.i] = r
        }
      }
      await sleep(5000)
    }

    const outSections = sections.map((s, i) => {
      const t = translated[i]
      return {
        title: String(t?.title ?? s.titleEn).trim(),
        titleEn: s.titleEn,
        // 번역 누락 섹션은 영어 원문 폴백 — 빈 화면보다 낫다
        body: String(t?.body ?? s.bodyEn).trim(),
        images: s.imageRefs
          .map((r, j) => ({
            url: urlMap.get(r.file) ?? null,
            caption: String(t?.captions?.[j] ?? r.caption ?? '').trim(),
          }))
          .filter((img) => img.url),
      }
    })
    const missing = translated.filter((t) => !t).length
    if (missing > 0) console.warn(`  ⚠ ${ch.slug}: ${missing}개 섹션 번역 누락 (영어 폴백)`)

    await writeFile(
      path.join(OUTPUT_DIR, `${ch.slug}.json`),
      `${JSON.stringify(
        {
          slug: ch.slug,
          nameKo: ch.nameKo,
          nameEn: ch.nameEn,
          sections: outSections,
          sourceUrl: ch.wikiUrl,
          license: 'CC BY-SA',
          generatedAt,
        },
        null,
        2,
      )}\n`,
    )
    index.done.push(ch.slug)
    console.log(
      `✓ ${ch.slug}: 섹션 ${outSections.length}개, 이미지 ${outSections.reduce((n, s) => n + s.images.length, 0)}장 (호출 ${chunks.length}회)`,
    )
  } catch (err) {
    console.error(`✗ ${ch.slug} 실패 (다음 실행에서 재시도): ${err}`)
  }
}

index.done = [...new Set(index.done)]
await writeFile(indexPath, `${JSON.stringify(index)}\n`)
console.log(`완료 ${index.done.length}/${chapters.length} (API 호출 ${getCallCount()}회)`)
