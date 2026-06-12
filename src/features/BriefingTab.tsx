import { useEffect, useState } from 'react'
import {
  fetchBriefing,
  fetchBriefingDates,
  fetchWeeklyDates,
  fetchWeeklyReport,
  type BriefingItem,
  type BriefingSection,
} from '../api/briefings'
import { useAsyncData } from '../hooks/useAsyncData'
import { TableSkeleton } from './Skeleton'

// 섹션 타입별 표시 (warning은 CSS에서 강조)
const SECTION_BADGES: Record<string, string> = {
  news: '📰',
  tips: '💡',
  community: '💬',
  warning: '⚠️',
  videos: '🎬',
}

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${date} (${weekday})`
}

// 헤드라인 타이프라이터 — 같은 문서는 세션 중 1회만 (날짜를 오가도 다시 안 침)
const typedOnce = new Set<string>()

function TypewriterHeadline({ text, docKey }: { text: string; docKey: string }) {
  const [skip] = useState(
    () =>
      typedOnce.has(docKey) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [n, setN] = useState(skip ? text.length : 0)

  useEffect(() => {
    if (skip) return
    // 헤드라인이 길어도 총 1.2초 안에 끝나도록 스텝 크기 조절
    const step = Math.max(1, Math.ceil(text.length / 40))
    const id = setInterval(() => {
      setN((prev) => {
        const next = Math.min(text.length, prev + step)
        if (next >= text.length) {
          clearInterval(id)
          typedOnce.add(docKey)
        }
        return next
      })
    }, 30)
    return () => clearInterval(id)
    // docKey가 바뀌면 key로 리마운트되므로 의존성은 비움
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <p className="briefing-headline" aria-label={text}>
      {text.slice(0, n)}
      {n < text.length && <span className="type-caret" aria-hidden />}
    </p>
  )
}

function videoIdFrom(url?: string): string | null {
  if (!url) return null
  const m = url.match(
    /(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/,
  )
  return m?.[1] ?? null
}

function ListItem({ item }: { item: BriefingItem }) {
  // 링크가 영상이면 우측에 미리보기 썸네일 — 글 카드에도 비주얼 한 점
  const vid = videoIdFrom(item.url)
  return (
    <li className={`briefing-item${vid ? ' has-thumb' : ''}`}>
      <div className="briefing-item-body">
        <strong>
          {item.title}
          {item.isNew && <span className="badge-new">🆕 NEW</span>}
        </strong>
        {item.summary && <p>{item.summary}</p>}
        {item.url && (
          <a className="source-link" href={item.url} target="_blank" rel="noreferrer">
            {item.source ?? '출처'} ↗
          </a>
        )}
      </div>
      {vid && (
        <a
          className="briefing-item-thumb"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          tabIndex={-1}
          aria-hidden
        >
          <img
            src={`https://i.ytimg.com/vi/${vid}/mqdefault.jpg`}
            alt=""
            loading="lazy"
          />
        </a>
      )}
    </li>
  )
}

// 영상 섹션은 유튜브 썸네일 카드로 (id를 못 읽는 항목은 일반 목록으로 폴백)
function VideoGrid({ items }: { items: BriefingItem[] }) {
  const cards = items.filter((i) => videoIdFrom(i.url))
  const plain = items.filter((i) => !videoIdFrom(i.url))
  return (
    <>
      {cards.length > 0 && (
        <ul className="video-grid">
          {cards.map((item, i) => (
            <li key={i}>
              {/* 풀블리드 썸네일 — 제목은 하단 그라데이션 위에 오버레이 */}
              <a
                className="video-card"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  className="video-bg"
                  src={`https://i.ytimg.com/vi/${videoIdFrom(item.url)}/hqdefault.jpg`}
                  alt=""
                  loading="lazy"
                />
                <span className="video-play" aria-hidden>
                  ▶
                </span>
                <span className="video-overlay">
                  <span className="video-title">
                    {item.title}
                    {item.isNew && <span className="badge-new">🆕</span>}
                  </span>
                  {item.source && <span className="video-src">{item.source}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {plain.length > 0 && (
        <ul>
          {plain.map((item, i) => (
            <ListItem key={i} item={item} />
          ))}
        </ul>
      )}
    </>
  )
}

// 벤토 크기 패턴 — 일반 섹션을 큰 칸/작은 칸/와이드로 번갈아 배치 (6열 그리드 기준)
const BENTO_PATTERN = ['bento-lg', 'bento-sm', 'bento-wide'] as const

function Section({
  section,
  index,
  bento,
}: {
  section: BriefingSection
  index: number
  bento: string
}) {
  const isWarning = section.type === 'warning'
  const isVideos = section.type === 'videos'
  return (
    <section
      className={`briefing-section${isWarning ? ' warning' : ''}${isVideos ? ' videos' : ''}${bento ? ` ${bento}` : ''}`}
      // 카드 stagger 진입 — 늦어도 0.5초 안에 전부 등장
      style={{ animationDelay: `${Math.min(index * 60, 300)}ms` }}
    >
      <h2>
        {SECTION_BADGES[section.type] ?? '•'} {section.title}
      </h2>
      {isVideos ? (
        <VideoGrid items={section.items} />
      ) : (
        <ul>
          {section.items.map((item, i) => (
            <ListItem key={i} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}

// 선택값 인코딩: "d:날짜" = 일일 브리핑, "w:날짜" = 주간 리포트
type DocKey = `d:${string}` | `w:${string}`

export function BriefingTab() {
  const datesState = useAsyncData(fetchBriefingDates)
  const weeklyState = useAsyncData(fetchWeeklyDates)
  const [selected, setSelected] = useState<DocKey | null>(null)

  const dailyDates = datesState.status === 'ready' ? datesState.data : []
  const weeklyDates = weeklyState.status === 'ready' ? weeklyState.data : []

  // 선택 전 기본값: 최신 일일 브리핑
  const key: DocKey | null =
    selected ?? (dailyDates[0] ? `d:${dailyDates[0]}` : null)
  const isWeekly = key?.startsWith('w:') ?? false
  const date = key?.slice(2) ?? null

  const briefingState = useAsyncData(
    () =>
      date
        ? isWeekly
          ? fetchWeeklyReport(date)
          : fetchBriefing(date)
        : Promise.reject(new Error('브리핑 없음')),
    [key],
  )

  if (datesState.status === 'loading') {
    return <TableSkeleton rows={4} label="브리핑 목록 불러오는 중…" />
  }
  if (datesState.status === 'error') {
    return <p className="status error">불러오기 실패: {datesState.message}</p>
  }
  if (!date) {
    return (
      <p className="status">
        아직 발행된 브리핑이 없습니다. 매일 오전 9시에 생성됩니다.
      </p>
    )
  }

  // 같은 종류(일일/주간) 안에서 이전·다음 날짜로 이동.
  // 날짜 목록은 최신순이라 "이전(과거)" = 인덱스 +1
  const kindDates = isWeekly ? weeklyDates : dailyDates
  const prefix = isWeekly ? 'w:' : 'd:'
  const cursor = date ? kindDates.indexOf(date) : -1
  const older =
    cursor >= 0 && cursor < kindDates.length - 1
      ? (`${prefix}${kindDates[cursor + 1]}` as DocKey)
      : null
  const newer =
    cursor > 0 ? (`${prefix}${kindDates[cursor - 1]}` as DocKey) : null

  return (
    <div>
      <div className="toolbar">
        <select
          value={key ?? ''}
          onChange={(e) => setSelected(e.target.value as DocKey)}
        >
          <optgroup label="일일 브리핑">
            {dailyDates.map((d) => (
              <option key={`d:${d}`} value={`d:${d}`}>
                {formatDate(d)}
                {d === dailyDates[0] ? ' — 최신' : ''}
              </option>
            ))}
          </optgroup>
          {weeklyDates.length > 0 && (
            <optgroup label="주간 메타 리포트">
              {weeklyDates.map((d) => (
                <option key={`w:${d}`} value={`w:${d}`}>
                  📅 {formatDate(d)} 주간 정리
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="quest-back"
          disabled={!older}
          onClick={() => older && setSelected(older)}
          aria-label="이전 날짜"
        >
          ◀ 이전
        </button>
        <button
          className="quest-back"
          disabled={!newer}
          onClick={() => newer && setSelected(newer)}
          aria-label="다음 날짜"
        >
          다음 ▶
        </button>
        <span className="hint">
          {isWeekly ? '매주 월요일 발행' : '매일 오전 9시 자동 발행'}
        </span>
      </div>

      {briefingState.status === 'loading' && (
        <TableSkeleton rows={4} label="브리핑 불러오는 중…" />
      )}
      {briefingState.status === 'error' && (
        <p className="status error">불러오기 실패: {briefingState.message}</p>
      )}
      {briefingState.status === 'ready' && (
        <article>
          <TypewriterHeadline
            key={key}
            text={briefingState.data.headline}
            docKey={key ?? ''}
          />
          {/* 주의사항을 항상 맨 위로 — 손해 보기 전에 봐야 하는 정보라서 */}
          <div className="briefing-grid">
            {(() => {
              const sorted = [...briefingState.data.sections].sort(
                (a, b) =>
                  Number(b.type === 'warning') - Number(a.type === 'warning'),
              )
              let regular = 0
              return sorted.map((section, i) => {
                const isFull =
                  section.type === 'warning' || section.type === 'videos'
                const bento = isFull
                  ? ''
                  : BENTO_PATTERN[regular++ % BENTO_PATTERN.length]
                return <Section key={i} section={section} index={i} bento={bento} />
              })
            })()}
          </div>
        </article>
      )}
    </div>
  )
}
