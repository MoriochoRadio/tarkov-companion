import { useState } from 'react'
import {
  fetchBriefing,
  fetchBriefingDates,
  type BriefingSection,
} from '../api/briefings'
import { useAsyncData } from '../hooks/useAsyncData'

// 섹션 타입별 표시 (warning은 CSS에서 강조)
const SECTION_BADGES: Record<string, string> = {
  news: '📰',
  tips: '💡',
  community: '💬',
  warning: '⚠️',
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
            <strong>{item.title}</strong>
            <p>{item.summary}</p>
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

export function BriefingTab() {
  const datesState = useAsyncData(fetchBriefingDates)
  const [selected, setSelected] = useState<string | null>(null)

  // 선택 전에는 목록의 첫 번째(최신) 날짜
  const dates = datesState.status === 'ready' ? datesState.data : []
  const date = selected ?? dates[0] ?? null

  const briefingState = useAsyncData(
    () => (date ? fetchBriefing(date) : Promise.reject(new Error('브리핑 없음'))),
    [date],
  )

  if (datesState.status === 'loading') {
    return <p className="status">브리핑 목록 불러오는 중…</p>
  }
  if (datesState.status === 'error') {
    return <p className="status error">불러오기 실패: {datesState.message}</p>
  }
  if (!date) {
    return <p className="status">아직 발행된 브리핑이 없습니다. 매일 오전 9시에 생성됩니다.</p>
  }

  return (
    <div>
      <div className="toolbar">
        <select value={date} onChange={(e) => setSelected(e.target.value)}>
          {dates.map((d) => (
            <option key={d} value={d}>
              {formatDate(d)}
              {d === dates[0] ? ' — 최신' : ''}
            </option>
          ))}
        </select>
        <span className="hint">매일 오전 9시 자동 발행</span>
      </div>

      {briefingState.status === 'loading' && (
        <p className="status">브리핑 불러오는 중…</p>
      )}
      {briefingState.status === 'error' && (
        <p className="status error">불러오기 실패: {briefingState.message}</p>
      )}
      {briefingState.status === 'ready' && (
        <article>
          <p className="briefing-headline">{briefingState.data.headline}</p>
          {/* 주의사항을 항상 맨 위로 — 손해 보기 전에 봐야 하는 정보라서 */}
          {[...briefingState.data.sections]
            .sort((a, b) => Number(b.type === 'warning') - Number(a.type === 'warning'))
            .map((section, i) => (
              <Section key={i} section={section} />
            ))}
        </article>
      )}
    </div>
  )
}
