import { useState } from 'react'
import { FirOps } from './FirOps'
import { HideoutView } from './HideoutView'
import { PrepChecklist } from './PrepTab'
import { QuestNeedsView } from './QuestNeedsView'
import { TrackerTab } from './TrackerTab'

// "내 진행" 탭 (Phase 38) — 퀘스트·은신처 진척과 그에 필요한 아이템을 한 곳에서.
// 기존엔 FIR 탭이 2단 모드(통합 운영/준비물 목록/트래커) + 준비물 안에 또 3모드라
// 핵심인 통합 체크리스트가 3단계 깊이에 묻혀 있었음(Phase 36 딥링크가 안 보임).
// → 한 줄 메뉴로 평탄화하고 통합 체크리스트를 기본 전면으로. 5개 뷰의 중복 로직
// 통합은 다음 슬라이스로 분리(저위험 유지).
type FirView = 'list' | 'hideout' | 'quests' | 'ops' | 'tracker'

const VIEWS: { key: FirView; label: string }[] = [
  { key: 'list', label: '통합 체크리스트' },
  { key: 'hideout', label: '은신처' },
  { key: 'quests', label: '퀘스트' },
  { key: 'ops', label: 'FIR 운영' },
  { key: 'tracker', label: '트래커·조직도' },
]

export function FirTab({
  onItem,
  onQuest,
}: {
  onItem?: (name: string) => void // 필요템 → 시세(검색) 딥링크 (Phase 36)
  onQuest?: (id: string) => void // 필요템 출처 퀘스트 → 퀘스트 상세 딥링크
}) {
  const [view, setView] = useState<FirView>('list')
  return (
    <div>
      <div className="toolbar">
        <nav className="mode-seg mode-seg-wrap" aria-label="내 진행 보기 방식">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={view === v.key ? 'active' : ''}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </nav>
      </div>
      {view === 'list' && <PrepChecklist onItem={onItem} onQuest={onQuest} />}
      {view === 'hideout' && <HideoutView />}
      {view === 'quests' && <QuestNeedsView />}
      {view === 'ops' && <FirOps />}
      {view === 'tracker' && <TrackerTab />}
    </div>
  )
}
