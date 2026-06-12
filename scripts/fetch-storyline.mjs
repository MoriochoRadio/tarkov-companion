// 1.0 스토리 챕터 데이터 저작 도구 — EFT 위키(CC BY-SA)에서 챕터 목록·목표를
// 받아 public/data/storyline.json을 생성한다. tarkov.dev API에는 스토리 챕터가
// 없음(tasks 510개는 전부 트레이더 의뢰 = 사이드퀘스트)을 2026-06-12 실측 확인.
//
// 사용법: node scripts/fetch-storyline.mjs
// - 한국어 필드(nameKo/startKo/descKo)와 챕터 순서는 아래 CURATED에서 관리
//   (위키는 영어라 자동화 불가 — 번역은 비공식, UI에도 명시)
// - 새 챕터가 위키에 생기면 CURATED 없이도 영어 폴백으로 들어오니,
//   실행 후 CURATED에 번역을 추가하고 다시 실행하면 됨
import fs from 'node:fs'
import path from 'node:path'

const WIKI_API = 'https://escapefromtarkov.fandom.com/api.php'
const OUT = path.join(process.cwd(), 'public', 'data', 'storyline.json')

// 챕터 순서·한국어 큐레이션. order는 시작 조건이 풀리는 자연스러운 진행 순서:
// 투어(자동) → 추락하는 하늘(투어 중 파생) → 필드 발견형 4종(대략 발견 난이도순)
// → 미궁(키 필요) → 언허드 → 보레아스(정보센터3/1.0.5 신규) → 티켓(최종장)
const CURATED = {
  tour: {
    order: 1,
    nameKo: '투어',
    startKo: '게임 시작 시 자동으로 추가됨 — 그라운드 제로(튜토리얼)에서 시작',
    descKo:
      '테라그룹 사무실 급습 중 인근 고층 건물 옥상에서 거대한 폭발이 일어났다. 지휘부와 연락이 끊긴 채 홀로 남았으니 철수는 스스로 해결해야 한다. 우선 이 그라운드 제로부터 빠져나가자.',
  },
  'falling-skies': {
    order: 2,
    nameKo: '추락하는 하늘',
    startKo: '‘투어’ 진행 중 메카닉에게 추락한 비행기에 대해 물으면 시작',
    descKo:
      '메카닉과 자연보호구역 어딘가에 추락한 비행기 이야기를 나눴다. 무슨 일이 있었는지는 아무도 모른다. 직접 찾아가 보면 흥미로운 것을 발견할지도 모른다.',
  },
  'accidental-witness': {
    order: 3,
    nameKo: '우연한 목격자',
    startKo: '커스텀 기숙사 마당의 낙서된 세단 차량을 발견하면 시작',
    descKo:
      '기숙사 옆에 협박 메시지가 적힌 세단이 서 있다. 주민 하나가 심각한 빚을 진 모양인데, 이 코즐로프만 채무자였던 것은 아닐 것이다. 그가 쫓기는 데는 이유가 있지 않을까?',
  },
  'they-are-already-here': {
    order: 4,
    nameKo: '그들은 이미 와 있다',
    startKo:
      '‘세계의 눈에 대한 쪽지’를 읽으면 시작 — 커스텀 기숙사 314 마킹룸 · 리저브 RB-BK/RB-VO/RB-PKPM 마킹룸 · 우즈 북쪽 폐촌 마킹 서클 · 쇼어라인 섬 가옥',
    descKo:
      '타르코프 곳곳에 기이한 문양을 남기는 후드 차림의 무리 — 컬티스트의 흔적을 쫓아 ‘세계의 눈’의 정체를 파헤치는 챕터.',
  },
  batya: {
    order: 5,
    nameKo: '바탸',
    startKo:
      '지정 지점 중 한 곳을 조사하면 시작 — 커스텀 스캐브 기지 2층 매트리스 · 리저브 화이트 퀸 레이더 기지 옥상 레이돔 등',
    descKo:
      'BEAR는 일반 분대만 보낸 것이 아니었다. 진짜 특수작전부대가 타르코프에 있었다. 그 부대가 누구였고 무엇을 하고 있었는지 알아내야 한다.',
  },
  'blue-fire': {
    order: 6,
    nameKo: '푸른 불꽃',
    startKo:
      'EMERCOM 전단 또는 ‘Item 1156 쪽지’를 읽으면 시작 — 우즈 스캐브 기지/EMERCOM 캠프의 녹색 컨테이너 등',
    descKo:
      '사무실 급습 중 옥상에서 특수 무기가 발동됐다. 정신을 잃기 전 푸른 섬광이 번쩍였고 그 후 모든 전자장비가 멈췄다. 이렇게 강력한 EMP 무기는 처음이다 — 도시를 덮친 기술의 정체를 알아내야 한다.',
  },
  'the-labyrinth': {
    order: 7,
    nameKo: '미궁',
    startKo:
      '쇼어라인 보양소 서관 지하의 ‘미궁’ 트랜짓 입구를 이용하면 시작 — 크노소스 LLC 시설 키 필요',
    descKo:
      '테라그룹 사무실 급습 전부터 그들의 지하 시설 소문이 돌았다. 해안 보양소 아래에서 방공호인지 또 다른 연구소인지 모를 ‘미궁’이 발견됐다고 한다. 직접 확인해 볼 가치가 있다.',
  },
  'the-unheard': {
    order: 8,
    nameKo: '언허드',
    startKo:
      '‘정화에 대한 헛소리가 적힌 쪽지’를 읽으면 시작 — 스트리트 테라그룹 경비초소 감시실/사무실 · 그라운드 제로(레벨 21+) 본관 2층 4번 사무실(키 필요)',
    descKo:
      '테라그룹 용지에 적힌 이상한 쪽지를 발견했다. ‘언허드의 의지’와 정화에 필요한 연료가 언급돼 있다. 테라그룹이 연루된 것이 분명하다 — 언허드에 대한 정보를 더 모아야 한다.',
  },
  boreas: {
    order: 9,
    nameKo: '보레아스',
    startKo:
      '패러다임 시핑 포스터를 습득하거나, 은신처 정보센터 3레벨의 무전 시스템에서 조난 신호를 확인하면 시작 (1.0.5 Icebreaker 신규)',
    descKo:
      '쇄빙선 ‘보레아스’에서 온 조난 신호를 추적해 빙해에 갇힌 배에 오르는 챕터 — 1.0.5 Icebreaker 업데이트로 추가됐다.',
  },
  'the-ticket': {
    order: 10,
    nameKo: '티켓',
    startKo: '은신처 정보센터 1레벨 건설 후 Mr. Kerman과 대화하면 시작 — ‘추락하는 하늘’에서 이어짐',
    descKo:
      '타르코프를 떠날 ‘티켓’을 손에 넣기 위한 최종장. 선택에 따라 4가지 엔딩(생존자·구원자·채무자·타락자) 중 하나로 갈린다.',
    final: true,
  },
}

function slugify(title) {
  return title
    .replace(/\s*\(story chapter\)\s*/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// 위키 마크업 → 평문. [[A|B]]→B, [[A]]→A, 볼드/이탤릭/HTML 태그/템플릿 제거
function stripMarkup(s) {
  return s
    .replace(/\[\[File:[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''|''/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function section(wikitext, name) {
  const m = wikitext.match(
    new RegExp(`==\\s*${name}\\s*==\\n([\\s\\S]*?)(?=\\n==[^=]|$)`),
  )
  return m ? m[1] : ''
}

// Objectives 섹션 → 구조화. depth(들여쓰기), optional, kind(branch=분기 제목, note=참고)
function parseObjectives(sec) {
  const out = []
  for (const raw of sec.split('\n')) {
    let line = raw.trim()
    if (!line || /^<hr\s*\/?>$/.test(line)) continue
    let depth = 0
    let kind = 'obj'
    if (/^=+[^=].*=+$/.test(line)) {
      kind = 'branch'
      line = line.replace(/^=+|=+$/g, '')
    } else if (/^\*+/.test(line)) {
      depth = line.match(/^\*+/)[0].length - 1
      line = line.replace(/^\*+\s*/, '')
    } else if (/^:?\s*'''/.test(line)) {
      kind = line.startsWith(':') ? 'note' : 'branch'
      line = line.replace(/^:\s*/, '')
    } else {
      kind = 'note'
    }
    let optional = false
    line = line.replace(/\(\s*(?:'')?Optional(?:'')?\s*\)/i, () => {
      optional = true
      return ''
    })
    const text = stripMarkup(line)
    if (!text) continue
    const o = { text, depth }
    if (optional) o.optional = true
    if (kind !== 'obj') o.kind = kind
    out.push(o)
  }
  return out
}

async function wiki(params) {
  const url = `${WIKI_API}?${new URLSearchParams({ format: 'json', ...params })}`
  const res = await fetch(url, {
    headers: { 'user-agent': 'tarkov-companion (storyline authoring tool)' },
  })
  if (!res.ok) throw new Error(`위키 응답 오류 HTTP ${res.status} (${url})`)
  return res.json()
}

const list = await wiki({
  action: 'query',
  list: 'categorymembers',
  cmtitle: 'Category:Story chapters',
  cmlimit: '100',
})
const titles = list.query.categorymembers
  .filter((m) => m.ns === 0 && m.title !== 'Story chapters')
  .map((m) => m.title)
console.log(`위키 스토리 챕터 ${titles.length}개:`, titles.join(', '))

const chapters = []
for (const title of titles) {
  const j = await wiki({ action: 'parse', page: title, prop: 'wikitext' })
  const w = j.parse.wikitext['*']
  const slug = slugify(title)
  const cur = CURATED[slug]
  if (!cur) {
    console.warn(`⚠ CURATED에 없는 새 챕터: ${slug} — 영어 폴백으로 수록, 번역 추가 필요`)
  }
  const nameEn = title.replace(/\s*\(story chapter\)\s*/i, '').trim()
  const quote = w.match(/\{\{quote\|([\s\S]*?)\}\}/)
  const reqText = stripMarkup(
    section(w, 'Requirements')
      .replace(/<gallery[\s\S]*?<\/gallery>/g, '')
      .replace(/<li[\s\S]*?>/g, '')
      .replace(/<\/li>/g, '')
      .replace(/\n\*+\s*/g, ' · ')
      .replace(/\n/g, ' '),
  )
  chapters.push({
    slug,
    order: cur?.order ?? 99,
    nameKo: cur?.nameKo ?? nameEn,
    nameEn,
    startKo: cur?.startKo ?? reqText,
    descKo: cur?.descKo ?? (quote ? stripMarkup(quote[1]) : ''),
    final: cur?.final ?? false,
    wikiUrl: `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    objectives: parseObjectives(section(w, 'Objectives')),
  })
  console.log(`  ${slug}: 목표 ${chapters.at(-1).objectives.length}줄`)
}

chapters.sort((a, b) => a.order - b.order || a.nameEn.localeCompare(b.nameEn))

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'https://escapefromtarkov.fandom.com/wiki/Story_chapters',
  license: 'CC BY-SA',
  note: '목표 목록은 EFT 위키 원문(영어), 챕터명·시작 조건·설명 한국어는 비공식 번역',
  chapters,
}
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n')
console.log(`✓ ${OUT} (챕터 ${chapters.length}개)`)
