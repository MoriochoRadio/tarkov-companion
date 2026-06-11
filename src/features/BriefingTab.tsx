import { useState } from 'react'
import {
  fetchBriefing,
  fetchBriefingDates,
  fetchWeeklyDates,
  fetchWeeklyReport,
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

function Section({ section }: { section: BriefingSection }) {
  const isWarning = section.type === 'warning'
  return (
    <section className={`briefing-section${isWarning ? ' warning' : ''}`}>
      <h2>
        {SECTION_BADGES[section.type] ?? '•'} {section.title}
      </h2>
      <ul>
        {section.items.map((item, i) => (
          <li key={i} className="briefing-item">
            <strong>
              {item.title}
              {item.isNew && <span className="badge-new">🆕 NEW</span>}
            </strong>
            {item.summary && <p>{item.summary}</p>}
            {item.url && (
              <a
                className="source-link"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                {item.source ?? '출처'} ↗
              </a>
            )}
          </li>
        ))}
      </ul>
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
          <p className="briefing-headline">{briefingState.data.headline}</p>
          {/* 주의사항을 항상 맨 위로 — 손해 보기 전에 봐야 하는 정보라서 */}
          {[...briefingState.data.sections]
            .sort(
              (a, b) =>
                Number(b.type === 'warning') - Number(a.type === 'warning'),
            )
            .map((section, i) => (
              <Section key={i} section={section} />
            ))}
        </article>
      )}
    </div>
  )
}
