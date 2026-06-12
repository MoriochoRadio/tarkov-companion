import { useState } from 'react'
import { fetchStoryline, type StoryChapter } from '../api/storyline'
import { useAsyncData } from '../hooks/useAsyncData'
import { STORY_DONE_KEY, useIdSet } from '../lib/favorites'
import { TableSkeleton } from './Skeleton'

// 1.0 메인 스토리라인 — 챕터 카드를 진행 순서대로. 퀘스트 탭의 기존 목록
// (트레이더 의뢰 510개)은 1.0 기준 전부 사이드퀘스트라 모드 세그먼트로 구분.
// 목표 목록은 위키 영어 원문 그대로 (분기·선택 단계가 많아 기계 번역 위험)

function ChapterCard({
  chapter,
  index,
  done,
  onToggleDone,
}: {
  chapter: StoryChapter
  index: number
  done: boolean
  onToggleDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const required = chapter.objectives.filter((o) => !o.optional && o.kind !== 'note')

  return (
    <li className={`story-card${done ? ' done' : ''}`}>
      <header className="story-head">
        <span className="story-num num">{String(index + 1).padStart(2, '0')}</span>
        <div className="story-title-wrap">
          <h3 className="story-title">
            {chapter.nameKo}
            <span className="story-name-en">{chapter.nameEn}</span>
            {chapter.final && <span className="badge-ending">엔딩 분기</span>}
            {done && <span className="hideout-built-badge">✓ 완료</span>}
          </h3>
          <p className="story-start">
            <span className="story-start-label">시작</span> {chapter.startKo}
          </p>
        </div>
        <button className={`btn-ext${done ? ' active' : ''}`} onClick={onToggleDone}>
          {done ? '완료 취소' : '완료로 표시'}
        </button>
      </header>
      {chapter.descKo && <p className="story-desc">{chapter.descKo}</p>}
      <div className="story-foot">
        <button className="quest-link" onClick={() => setOpen((v) => !v)}>
          {open ? '▾ 목표 접기' : `▸ 목표 ${required.length}단계 보기 (영어 원문)`}
        </button>
        <a className="source-link" href={chapter.wikiUrl} target="_blank" rel="noreferrer">
          위키 공략 ↗
        </a>
      </div>
      {open && (
        <ul className="story-objectives">
          {chapter.objectives.map((o, i) => (
            <li
              key={i}
              className={
                o.kind === 'branch'
                  ? 'story-branch'
                  : o.kind === 'note'
                    ? 'story-note dim'
                    : `story-obj depth-${o.depth}`
              }
            >
              {o.kind === 'branch' ? (
                o.text
              ) : (
                <>
                  {o.kind !== 'note' && <span className="dim">☐ </span>}
                  {o.text}
                  {o.optional && <span className="dim"> (선택)</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function StorylineView() {
  const state = useAsyncData(fetchStoryline)
  const { ids: doneIds, toggle: toggleDone } = useIdSet(STORY_DONE_KEY)

  if (state.status === 'loading') {
    return <TableSkeleton rows={6} label="스토리라인 데이터 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  const { chapters, generated } = state.data
  const doneCount = chapters.filter((c) => doneIds.has(c.slug)).length

  return (
    <div>
      <p className="hint">
        1.0의 메인 스토리는 트레이더 의뢰와 별개인 <strong>스토리 챕터</strong>로
        진행됩니다 — 마지막 챕터에서 4가지 엔딩으로 타르코프 탈출 · 챕터
        한국어명은 비공식 번역 · 진행:{' '}
        <span className="num">
          {doneCount}/{chapters.length}
        </span>{' '}
        챕터 · 출처: EFT 위키 (CC BY-SA, {generated} 기준)
      </p>
      <ol className="story-list">
        {chapters.map((c, i) => (
          <ChapterCard
            key={c.slug}
            chapter={c}
            index={i}
            done={doneIds.has(c.slug)}
            onToggleDone={() => toggleDone(c.slug)}
          />
        ))}
      </ol>
    </div>
  )
}
