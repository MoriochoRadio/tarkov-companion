// EFT 위키 이미지 헬퍼 — 위키텍스트에서 File: 참조를 뽑고 실제 CDN URL로 변환.
// 가이드에 첨부된 위치 스크린샷·지도 마킹을 사이트에서 그대로 보여주기 위함.
// URL은 핫링크(static.wikia.nocookie.net) — 저장소에 이미지를 담지 않는다.
const WIKI_API = 'https://escapefromtarkov.fandom.com/api.php'
const UA = 'tarkov-companion-guides/1.0 (github.com/MoriochoRadio/tarkov-companion)'

// 캡션이 아닌 위키 이미지 파라미터 (크기/정렬/링크 지정)
const NON_CAPTION = /^(thumb|frame|frameless|border|left|right|center|none|baseline|sub|super|top|text-top|middle|bottom|text-bottom|upright|\d+px|x\d+px|\d+x\d+px|link=.*|alt=.*|class=.*|lang=.*)$/i

/**
 * 위키텍스트 조각에서 이미지 참조 추출 → [{file, caption}]
 * 대응: [[File:X.png|...|캡션]] 와 <gallery> File:X.png|캡션 </gallery>
 */
export function extractImageRefs(wikitext) {
  const refs = []
  const seen = new Set()
  const push = (file, caption) => {
    const name = file.trim().replace(/^(?:File|Image):/i, '')
    if (!name || seen.has(name)) return
    // 아이템 아이콘(표 장식)은 위치 스크린샷이 아님 — 제외
    if (/icon\.(png|jpe?g|gif|webp)$/i.test(name) || /\bicon\b/i.test(name)) return
    seen.add(name)
    refs.push({ file: name, caption: (caption ?? '').trim() })
  }
  // [[File:...]] — 파이프 구분 파라미터 중 마지막 비파라미터 조각이 캡션
  for (const m of wikitext.matchAll(/\[\[(?:File|Image):([^\]|]+)((?:\|[^\]]*)?)\]\]/gi)) {
    const params = (m[2] ?? '').split('|').map((s) => s.trim()).filter(Boolean)
    const caption = params.filter((p) => !NON_CAPTION.test(p)).pop()
    push(m[1], caption)
  }
  // <gallery> 블록 — 줄마다 File명|캡션
  for (const g of wikitext.matchAll(/<gallery[^>]*>([\s\S]*?)<\/gallery>/gi)) {
    for (const line of g[1].split('\n')) {
      const t = line.trim()
      if (!t || !/\.(png|jpe?g|gif|webp)/i.test(t)) continue
      const [file, ...rest] = t.split('|')
      push(file, rest.filter((p) => !NON_CAPTION.test(p.trim())).pop())
    }
  }
  return refs
}

/**
 * File명 배열 → URL 맵 (Map<file, url>). 640px 썸네일 우선(원본은 수 MB일 수 있음).
 * MediaWiki imageinfo는 한 요청에 50개까지 — 배치 처리.
 */
export async function resolveImageUrls(files) {
  const out = new Map()
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50)
    const url = `${WIKI_API}?${new URLSearchParams({
      format: 'json',
      formatversion: '2',
      action: 'query',
      titles: batch.map((f) => `File:${f}`).join('|'),
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '640',
    })}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`위키 imageinfo HTTP ${res.status}`)
    const json = await res.json()
    for (const page of json.query?.pages ?? []) {
      const info = page.imageinfo?.[0]
      if (!info) continue
      const name = page.title.replace(/^File:/, '')
      out.set(name, info.thumburl ?? info.url)
    }
  }
  // 정규화 차이(언더스코어 ↔ 공백) 보정
  for (const f of files) {
    if (!out.has(f)) {
      const alt = out.get(f.replace(/_/g, ' '))
      if (alt) out.set(f, alt)
    }
  }
  return out
}
