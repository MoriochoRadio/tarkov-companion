// generate-briefing.mjs를 임시 폴더에서 실제로 돌려 보는 테스트 (네트워크 없음)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../generate-briefing.mjs', import.meta.url))

function run(collected, existing = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'briefing-test-'))
  const out = path.join(dir, 'out')
  mkdirSync(path.join(dir, 'tmp'), { recursive: true })
  mkdirSync(out, { recursive: true })
  writeFileSync(path.join(dir, 'tmp', 'collected.json'), JSON.stringify(collected))
  for (const [date, b] of Object.entries(existing)) {
    writeFileSync(path.join(out, `${date}.json`), JSON.stringify(b))
  }
  const log = execFileSync(process.execPath, [SCRIPT], {
    cwd: dir,
    env: { ...process.env, OUTPUT_DIR: out },
    encoding: 'utf8',
  })
  const read = () => JSON.parse(readFileSync(path.join(out, `${collected.date}.json`), 'utf8'))
  return { dir, out, log, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const reddit = (n, feed = '일간 인기') => ({
  title: `[Discussion] post ${n}`,
  url: `https://www.reddit.com/r/EscapefromTarkov/comments/${n}/`,
  feed,
  source: 'Reddit r/EscapefromTarkov',
})
const video = (id, title) => ({
  title,
  url: `https://www.youtube.com/watch?v=${id}`,
  source: 'YouTube LVNDMARK',
})

const yesterday = {
  date: '2026-11-09',
  generatedAt: '2026-11-09T09:17:00+09:00',
  headline: 'x',
  sections: [
    {
      type: 'community',
      title: '오늘의 인기 글 (Reddit)',
      items: [{ title: 'old post', url: 'https://www.reddit.com/r/EscapefromTarkov/comments/old/', source: 'Reddit r/EscapefromTarkov', isNew: true }],
    },
    {
      type: 'videos',
      title: '신규 영상',
      items: [{ title: 'Yesterday video - Escape From Tarkov', url: 'https://www.youtube.com/watch?v=yyyyyyyyyyy', source: 'YouTube LVNDMARK' }],
    },
  ],
}

test('Reddit이 429로 실패하면 어제 Reddit 글을 날짜 표시와 함께 싣고 degraded를 남긴다', () => {
  const r = run(
    {
      date: '2026-11-10',
      sources: { youtube: [video('zzzzzzzzzzz', 'New video - Escape From Tarkov')] },
      errors: [{ source: 'reddit', message: 'Error: HTTP 429: https://www.reddit.com/r/EscapefromTarkov/top/.rss' }],
    },
    { '2026-11-09': yesterday },
  )
  try {
    const b = r.read()
    assert.deepEqual(b.degraded, ['reddit'])
    const carried = b.sections.find((s) => s.carriedFrom)
    assert.equal(carried.title, '오늘의 인기 글 (Reddit) — 11/09 수집분 (오늘 수집 실패)')
    assert.equal(carried.items[0].isNew, undefined)
    assert.match(b.headline, /Reddit 수집 실패/)
    assert.doesNotMatch(b.headline, /커뮤니티/) // 지난 글은 오늘 건수로 세지 않는다
  } finally {
    r.cleanup()
  }
})

test('이어 붙일 Reddit 글이 없으면 실패 안내 섹션을 싣는다', () => {
  const r = run({
    date: '2026-11-10',
    sources: { youtube: [] },
    errors: [{ source: 'reddit', message: 'Error: HTTP 429: x' }],
  })
  try {
    const b = r.read()
    assert.deepEqual(b.degraded, ['reddit'])
    assert.equal(b.sections.length, 1)
    assert.equal(b.sections[0].title, 'Reddit (오늘 수집 실패)')
    assert.match(b.sections[0].items[0].title, /HTTP 429/)
  } finally {
    r.cleanup()
  }
})

test('백업 실행이 Reddit을 다시 받으면 오늘 글로 바뀌고 degraded가 사라진다', () => {
  const degradedToday = {
    date: '2026-11-10',
    generatedAt: '2026-11-10T09:17:00+09:00',
    headline: 'x',
    degraded: ['reddit'],
    sections: [{ ...yesterday.sections[0], title: '오늘의 인기 글 (Reddit) — 11/09 수집분 (오늘 수집 실패)', carriedFrom: '2026-11-09' }],
  }
  const r = run(
    { date: '2026-11-10', sources: { reddit: [reddit(1), reddit(2)] }, errors: [] },
    { '2026-11-09': yesterday, '2026-11-10': degradedToday },
  )
  try {
    const b = r.read()
    assert.equal(b.degraded, undefined)
    assert.equal(b.sections[0].title, '오늘의 인기 글 (Reddit)')
    assert.equal(b.sections[0].items.length, 2)
  } finally {
    r.cleanup()
  }
})

test('다시 실패하면 파일을 그대로 둔다 (generatedAt만 바뀌는 커밋 방지)', () => {
  const collected = {
    date: '2026-11-10',
    sources: {},
    errors: [{ source: 'reddit', message: 'Error: HTTP 429: x' }],
  }
  const first = run(collected, { '2026-11-09': yesterday })
  try {
    const before = readFileSync(path.join(first.out, '2026-11-10.json'), 'utf8')
    const second = run(collected, { '2026-11-09': yesterday, '2026-11-10': JSON.parse(before) })
    try {
      assert.match(second.log, /덮어쓰지 않음/)
      assert.equal(second.read().generatedAt, JSON.parse(before).generatedAt)
    } finally {
      second.cleanup()
    }
  } finally {
    first.cleanup()
  }
})

test('재수집 때 아침엔 됐던 소스가 실패하면 오늘 앞선 실행분을 그대로 둔다 (degraded 아님)', () => {
  const morning = {
    date: '2026-11-10',
    generatedAt: '2026-11-10T09:17:00+09:00',
    headline: 'x',
    degraded: ['reddit'],
    sections: [
      {
        type: 'news',
        title: '패치노트 (EFT 위키)',
        items: [{ title: '패치 1.3', url: 'https://escapefromtarkov.fandom.com/wiki/Changelog#1.3', source: 'EFT 위키 체인지로그' }],
      },
    ],
  }
  const r = run(
    {
      date: '2026-11-10',
      sources: { reddit: [reddit(1)] },
      errors: [{ source: 'wikiChangelog', message: 'Error: HTTP 503: x' }],
    },
    { '2026-11-10': morning },
  )
  try {
    const b = r.read()
    assert.equal(b.degraded, undefined)
    assert.equal(b.sections[0].title, '패치노트 (EFT 위키)')
    assert.equal(b.sections[0].carriedFrom, undefined)
  } finally {
    r.cleanup()
  }
})

test('지난 날짜 이어 싣기는 Reddit만 — 영상이 통째로 실패하면 섹션 없이 degraded만', () => {
  const r = run(
    {
      date: '2026-11-10',
      sources: { reddit: [reddit(1)] },
      errors: [{ source: 'youtube', message: 'Error: 모든 YouTube 채널 피드 실패' }],
    },
    { '2026-11-09': yesterday },
  )
  try {
    const b = r.read()
    assert.deepEqual(b.degraded, ['youtube'])
    assert.equal(b.sections.some((s) => s.type === 'videos'), false)
  } finally {
    r.cleanup()
  }
})

test('어제 브리핑에 실린 영상과 같은 날 재업로드는 빠진다', () => {
  const r = run(
    {
      date: '2026-11-10',
      sources: {
        youtube: [
          video('yyyyyyyyyyy', 'Yesterday video - Escape From Tarkov'),
          video('zzzzzzzzzzz', 'New video - Escape From Tarkov'),
          video('wwwwwwwwwww', 'NEW VIDEO — Escape From Tarkov'),
        ],
        reddit: [reddit(1)],
      },
      errors: [],
    },
    { '2026-11-09': yesterday },
  )
  try {
    const vids = r.read().sections.find((s) => s.type === 'videos').items
    assert.deepEqual(vids.map((v) => v.url), ['https://www.youtube.com/watch?v=zzzzzzzzzzz'])
  } finally {
    r.cleanup()
  }
})
