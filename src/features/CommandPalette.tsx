import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchQuests, type Quest } from '../api/quests'
import { fetchAllItems, type TarkovItem } from '../api/tarkov'
import { formatRub } from '../lib/format'

const MAX_PER_KIND = 6

interface Entry {
  kind: 'tab' | 'item' | 'quest'
  id: string
  label: string
  sub: string
  iconLink?: string | null
}

// Ctrl+K 빠른 검색 — 탭 이동 + 아이템/퀘스트 점프를 한 입력창에서.
// 데이터는 기존 세션 캐시(fetchAllItems/fetchQuests)를 그대로 쓰므로
// 이미 탭을 둘러본 뒤라면 즉시, 처음이면 백그라운드 로드 후 검색됨
export function CommandPalette({
  tabs,
  onTab,
  onItem,
  onQuest,
  onClose,
}: {
  tabs: readonly { key: string; label: string }[]
  onTab: (key: string) => void
  onItem: (name: string) => void
  onQuest: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<TarkovItem[] | null>(null)
  const [quests, setQuests] = useState<Quest[] | null>(null)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let on = true
    fetchAllItems()
      .then((d) => on && setItems(d))
      .catch(() => {}) // 실패해도 탭 이동은 동작해야 함
    fetchQuests()
      .then((d) => on && setQuests(d))
      .catch(() => {})
    inputRef.current?.focus()
    return () => {
      on = false
    }
  }, [])

  const q = query.trim().toLowerCase()

  const results = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    for (const t of tabs) {
      if (!q || t.label.toLowerCase().includes(q)) {
        out.push({ kind: 'tab', id: t.key, label: t.label, sub: '탭 이동' })
      }
    }
    if (q.length >= 2) {
      // 배열 앞에서 6개만 자르면 정확히 일치하는 항목이 뒤에 묻힘 →
      // 전체 매칭을 모아 "이름이 q로 시작" 우선으로 정렬한 뒤 6개만
      if (items) {
        const matched = items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.shortName.toLowerCase().includes(q),
        )
        const prefix = (i: TarkovItem) =>
          i.name.toLowerCase().startsWith(q) || i.shortName.toLowerCase().startsWith(q)
            ? 0
            : 1
        matched.sort(
          (a, b) => prefix(a) - prefix(b) || (b.avg24hPrice ?? 0) - (a.avg24hPrice ?? 0),
        )
        for (const i of matched.slice(0, MAX_PER_KIND)) {
          out.push({
            kind: 'item',
            id: i.id,
            label: i.name,
            sub: `아이템 · ${formatRub(i.avg24hPrice)}`,
            iconLink: i.iconLink,
          })
        }
      }
      if (quests) {
        const matched = quests.filter((quest) => quest.searchKey.includes(q))
        const prefix = (quest: Quest) => (quest.searchKey.startsWith(q) ? 0 : 1)
        matched.sort(
          (a, b) => prefix(a) - prefix(b) || a.minPlayerLevel - b.minPlayerLevel,
        )
        for (const quest of matched.slice(0, MAX_PER_KIND)) {
          out.push({
            kind: 'quest',
            id: quest.id,
            label: quest.displayName,
            sub: `퀘스트 · ${quest.trader.name} · 레벨 ${quest.minPlayerLevel}+`,
          })
        }
      }
    }
    return out
  }, [tabs, q, items, quests])

  // 결과가 바뀌면 커서를 범위 안으로
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, results.length - 1)))
  }, [results])

  const run = (entry: Entry) => {
    if (entry.kind === 'tab') onTab(entry.id)
    else if (entry.kind === 'item') onItem(entry.label)
    else onQuest(entry.id)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      if (results[cursor]) run(results[cursor])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  // 커서가 움직이면 보이게 스크롤
  useEffect(() => {
    listRef.current
      ?.querySelector('.palette-row.active')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const loading = q.length >= 2 && (!items || !quests)

  return (
    <div className="palette-overlay" onClick={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-label="빠른 검색"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="search"
          placeholder="탭 이름, 아이템, 퀘스트 검색… (↑↓ 이동, Enter 선택)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" ref={listRef} role="listbox">
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.id}`}>
              <button
                className={`palette-row${i === cursor ? ' active' : ''}`}
                role="option"
                aria-selected={i === cursor}
                onClick={() => run(r)}
                onMouseEnter={() => setCursor(i)}
              >
                {r.iconLink ? (
                  <img src={r.iconLink} alt="" loading="lazy" />
                ) : (
                  <span className="palette-glyph" aria-hidden>
                    {r.kind === 'tab' ? '⇥' : '☰'}
                  </span>
                )}
                <span className="palette-label">{r.label}</span>
                <span className="palette-sub dim">{r.sub}</span>
              </button>
            </li>
          ))}
          {loading && <li className="palette-note dim">아이템·퀘스트 데이터 불러오는 중…</li>}
          {!loading && q.length >= 2 && results.length === 0 && (
            <li className="palette-note dim">검색 결과 없음</li>
          )}
          {q.length > 0 && q.length < 2 && (
            <li className="palette-note dim">아이템·퀘스트는 2글자부터 검색됩니다</li>
          )}
        </ul>
      </div>
    </div>
  )
}
