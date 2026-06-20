import { useEffect, useMemo, useState } from 'react'
import { fetchStoryline, type StoryChapter, type StoryObjective } from '../api/storyline'
import { fetchStoryGuide, type StoryGuideImage } from '../api/storyGuides'
import { useAsyncData } from '../hooks/useAsyncData'
import { STORY_DONE_KEY, useIdSet } from '../lib/favorites'
import { ErrorState, TableSkeleton } from './Skeleton'

// 1.0 메인 스토리라인 — 챕터 카드(진행 순서) → 상세(목표 한국어 + 위키 공략
// 충실 번역 + 위치 스크린샷). 목표 번역은 storyline.json에 큐레이션(즉시),
// 공략 본문은 story-guides.yml이 생성하는 별도 JSON(챕터당 수십 KB, 지연 로드)

// 공략 섹션 수가 많은 챕터(보레아스 51개) 대비 2단계 렌더
const FIRST_SECTIONS = 8

function ObjectiveLine({ o }: { o: StoryObjective }) {
  if (o.kind === 'branch') {
    return <li className="story-branch">{o.ko ?? o.text}</li>
  }
  if (o.kind === 'note') {
    return <li className="story-note dim">{o.ko ?? o.text}</li>
  }
  return (
    <li className={`story-obj depth-${o.depth}`} title={o.ko ? o.text : undefined}>
      <span className="dim">☐ </span>
      {o.ko ?? o.text}
      {o.optional && <span className="dim"> (선택)</span>}
    </li>
  )
}

// 공략 본문 — "- " 목록, "[소제목]", 일반 단락의 3종 줄을 블록으로 묶어 렌더
function GuideBody({ body }: { body: string }) {
  const blocks = useMemo(() => {
    const out: ({ kind: 'p' | 'h'; text: string } | { kind: 'ul'; items: string[] })[] = []
    for (const raw of body.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      // 목록 마커는 생성 모델에 따라 "- " / "* " 둘 다 나옴
      if (/^[-*]\s+/.test(line)) {
        const item = line.replace(/^[-*]\s+/, '')
        const last = out.at(-1)
        if (last?.kind === 'ul') last.items.push(item)
        else out.push({ kind: 'ul', items: [item] })
      } else if (/^\[.+\]$/.test(line)) {
        out.push({ kind: 'h', text: line.slice(1, -1) })
      } else {
        out.push({ kind: 'p', text: line })
      }
    }
    return out
  }, [body])

  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'ul' ? (
          <ul key={i} className="guide-list">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : b.kind === 'h' ? (
          <h5 key={i} className="guide-subhead">
            {b.text}
          </h5>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </>
  )
}

function ChapterDetail({
  chapter,
  index,
  done,
  onToggleDone,
  onBack,
}: {
  chapter: StoryChapter
  index: number
  done: boolean
  onToggleDone: () => void
  onBack: () => void
}) {
  const guideState = useAsyncData(() => fetchStoryGuide(chapter.slug), [chapter.slug])
  const [zoomed, setZoomed] = useState<StoryGuideImage | null>(null)
  const [visibleSections, setVisibleSections] = useState(FIRST_SECTIONS)
  const guide =
    guideState.status === 'ready' && guideState.data !== 'pending'
      ? guideState.data
      : null

  useEffect(() => {
    if (!guide) return
    const t = setTimeout(() => setVisibleSections(Infinity), 60)
    return () => clearTimeout(t)
  }, [guide])

  return (
    <div>
      <div className="toolbar">
        <button className="quest-back" onClick={onBack}>
          ← 챕터 목록으로
        </button>
        <a className="source-link" href={chapter.wikiUrl} target="_blank" rel="noreferrer">
          위키 원문 ↗
        </a>
      </div>

      <header className="quest-hero">
        <span className="story-num num story-num-hero">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="quest-hero-text">
          <p className="quest-hero-meta">스토리 챕터 {index + 1}/10</p>
          <h2 className="quest-title">
            {chapter.nameKo}
            <span className="story-name-en">{chapter.nameEn}</span>
            {chapter.final && <span className="badge-ending">엔딩 분기</span>}
          </h2>
        </div>
        <button className={`btn-ext${done ? ' active' : ''}`} onClick={onToggleDone}>
          {done ? '✓ 완료함' : '완료로 표시'}
        </button>
      </header>

      <p className="story-start">
        <span className="story-start-label">시작</span> {chapter.startKo}
      </p>
      {chapter.descKo && <p className="story-desc">{chapter.descKo}</p>}

      <section className="briefing-section">
        <h2>🎯 목표 ({chapter.objectives.filter((o) => !o.kind).length}단계)</h2>
        <ul className="story-objectives">
          {chapter.objectives.map((o, i) => (
            <ObjectiveLine key={i} o={o} />
          ))}
        </ul>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          영어 원문은 각 줄에 마우스를 올리면 표시 · 챕터명·목표 한국어는 비공식 번역
        </p>
      </section>

      {guideState.status === 'loading' && (
        <TableSkeleton rows={4} label="공략 불러오는 중…" />
      )}
      {guideState.status === 'ready' && guideState.data === 'pending' && (
        <p className="hint">
          📖 이 챕터의 한국어 공략은 자동 번역 생성 중입니다 — 그동안은{' '}
          <a className="source-link" href={chapter.wikiUrl} target="_blank" rel="noreferrer">
            위키 원문 ↗
          </a>
          을 참고하세요.
        </p>
      )}
      {guide && (
        <section className="briefing-section">
          <h2>📖 단계별 공략</h2>
          {guide.sections.slice(0, visibleSections).map((s, i) => (
            <article key={i} className="story-guide-section">
              <h4 className="story-guide-title">
                {s.title}
                {s.title !== s.titleEn && (
                  <span className="story-name-en">{s.titleEn}</span>
                )}
              </h4>
              <div className="story-guide-body">
                <GuideBody body={s.body} />
              </div>
              {s.images.length > 0 && (
                <ul className="story-guide-shots">
                  {s.images.map((img, j) => (
                    <li key={j}>
                      <button onClick={() => setZoomed(img)} title="클릭하면 크게">
                        <img src={img.url} alt={img.caption} loading="lazy" />
                      </button>
                      {img.caption && <span className="dim">{img.caption}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
          {guide.sections.length > visibleSections && (
            <p className="hint">나머지 섹션 표시 중…</p>
          )}
          <p className="hint" style={{ margin: '10px 0 0' }}>
            출처:{' '}
            <a className="source-link" href={guide.sourceUrl} target="_blank" rel="noreferrer">
              EFT 위키 ({guide.license}) ↗
            </a>{' '}
            · 이미지: EFT 위키 · AI 번역({guide.generatedAt.slice(0, 10)}) — 부정확할
            수 있으니 이상하면 원문 확인 권장
          </p>
        </section>
      )}

      {zoomed && (
        <div
          className="lightbox"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-label={zoomed.caption || '공략 이미지'}
        >
          <figure>
            <img src={zoomed.url} alt={zoomed.caption} />
            <figcaption>
              {zoomed.caption}
              <span className="dim"> · 클릭하면 닫힘 · 이미지: EFT 위키</span>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}

function ChapterCard({
  chapter,
  index,
  done,
  onToggleDone,
  onOpen,
}: {
  chapter: StoryChapter
  index: number
  done: boolean
  onToggleDone: () => void
  onOpen: () => void
}) {
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
        <button className="quest-link" onClick={onOpen}>
          📖 목표 {required.length}단계 + 한국어 공략 보기 →
        </button>
      </div>
    </li>
  )
}

export function StorylineView() {
  const state = useAsyncData(fetchStoryline)
  const { ids: doneIds, toggle: toggleDone } = useIdSet(STORY_DONE_KEY)
  const [openSlug, setOpenSlug] = useState<string | null>(null)

  if (state.status === 'loading') {
    return <TableSkeleton rows={6} label="스토리라인 데이터 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <ErrorState message={state.message} onRetry={state.reload} />
  }

  const { chapters, generated } = state.data
  const doneCount = chapters.filter((c) => doneIds.has(c.slug)).length
  const openIndex = chapters.findIndex((c) => c.slug === openSlug)

  if (openIndex >= 0) {
    const c = chapters[openIndex]
    return (
      <ChapterDetail
        chapter={c}
        index={openIndex}
        done={doneIds.has(c.slug)}
        onToggleDone={() => toggleDone(c.slug)}
        onBack={() => setOpenSlug(null)}
      />
    )
  }

  return (
    <div>
      <p className="hint">
        1.0의 메인 스토리는 트레이더 의뢰와 별개인 <strong>스토리 챕터</strong>로
        진행됩니다 — 마지막 챕터에서 4가지 엔딩으로 타르코프 탈출 · 챕터를 열면
        목표 전체와 한국어 공략(위치 사진 포함) · 진행:{' '}
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
            onOpen={() => setOpenSlug(c.slug)}
          />
        ))}
      </ol>
    </div>
  )
}
