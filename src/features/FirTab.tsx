import { useState } from 'react'
import { FirOps } from './FirOps'
import { PrepTab } from './PrepTab'
import { TrackerTab } from './TrackerTab'

// FIR 통합 탭 (Phase 28) — 준비물 + FIR 트래커를 한 탭으로 합침.
// 기본은 2분할 운영 페이지(FirOps). 기존 화면은 기능 삭제 없이 보조 보기로 흡수:
//  · 준비물 목록 = 통합 체크리스트/은신처/퀘스트 상세 (검색·필터)
//  · 트래커·조직도 = 은신처 의존성 조직도 + 상인별 정크박스 상세
type FirView = 'ops' | 'prep' | 'tracker'

export function FirTab() {
  const [view, setView] = useState<FirView>('ops')
  return (
    <div>
      <div className="toolbar">
        <nav className="mode-seg" aria-label="FIR 보기 방식">
          <button className={view === 'ops' ? 'active' : ''} onClick={() => setView('ops')}>
            통합 운영
          </button>
          <button className={view === 'prep' ? 'active' : ''} onClick={() => setView('prep')}>
            준비물 목록
          </button>
          <button
            className={view === 'tracker' ? 'active' : ''}
            onClick={() => setView('tracker')}
          >
            트래커·조직도
          </button>
        </nav>
      </div>
      {view === 'ops' && <FirOps />}
      {view === 'prep' && <PrepTab />}
      {view === 'tracker' && <TrackerTab />}
    </div>
  )
}
