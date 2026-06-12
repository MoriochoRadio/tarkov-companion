import { useRef, useState } from 'react'

// 내 데이터 백업/복원 — 즐겨찾기·진행 중 퀘스트·체크리스트·은신처·알림이
// 전부 localStorage라 브라우저를 바꾸거나 캐시를 지우면 사라진다.
// 서버 없는 제약에서의 해답: JSON 파일로 내보내고 다른 기기에서 가져오기

const DATA_KEYS = [
  'tc:fav-items',
  'tc:active-quests',
  'tc:prep-counts',
  'tc:hideout-built',
  'tc:my-level',
  'tc:price-alerts',
  'tc:quest-item-marks',
] as const

const KEY_LABELS: Record<string, string> = {
  'tc:fav-items': '즐겨찾기',
  'tc:active-quests': '진행 중 퀘스트',
  'tc:prep-counts': '준비물 체크리스트',
  'tc:hideout-built': '은신처 건설 상태',
  'tc:my-level': '내 레벨',
  'tc:price-alerts': '가격 알림',
  'tc:quest-item-marks': '퀘스트 아이템 그리드 표시',
}

function exportData() {
  const data: Record<string, string> = {}
  for (const k of DATA_KEYS) {
    try {
      const v = localStorage.getItem(k)
      if (v != null) data[k] = v
    } catch {
      // 접근 불가 — 건너뜀
    }
  }
  const payload = {
    app: 'tarkov-companion',
    version: 1,
    exported: new Date().toISOString(),
    data,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `tarkov-companion-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function DataManager() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const importFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as {
        app?: string
        data?: Record<string, string>
      }
      if (json.app !== 'tarkov-companion' || !json.data) {
        setMessage('이 사이트의 백업 파일이 아닙니다.')
        return
      }
      let n = 0
      for (const [k, v] of Object.entries(json.data)) {
        // 백업에 든 키만, 그리고 우리가 아는 키만 복원 (이물질 차단)
        if ((DATA_KEYS as readonly string[]).includes(k) && typeof v === 'string') {
          localStorage.setItem(k, v)
          n++
        }
      }
      setMessage(`${n}개 항목 복원 — 적용을 위해 새로고침합니다…`)
      // 메모리에 든 스토어들을 전부 다시 읽는 가장 확실한 방법
      setTimeout(() => location.reload(), 900)
    } catch {
      setMessage('파일을 읽을 수 없습니다 — 손상됐거나 형식이 다릅니다.')
    }
  }

  const reset = () => {
    if (!window.confirm('즐겨찾기·체크리스트·은신처 등 저장된 데이터를 전부 지웁니다. 되돌릴 수 없습니다 — 계속할까요?')) {
      return
    }
    for (const k of DATA_KEYS) {
      try {
        localStorage.removeItem(k)
      } catch {
        // 무시
      }
    }
    location.reload()
  }

  return (
    <>
      <button className="data-btn" onClick={() => setOpen(true)}>
        내 데이터
      </button>
      {open && (
        <div className="palette-overlay" onClick={() => setOpen(false)} role="presentation">
          <div
            className="palette data-dialog"
            role="dialog"
            aria-label="내 데이터 관리"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>내 데이터</h3>
            <p className="hint">
              즐겨찾기·진행 중 퀘스트·체크리스트·은신처·알림은 전부 이 브라우저에만
              저장됩니다. 다른 기기로 옮기거나 백업하려면 파일로 내보내세요.
            </p>
            <ul className="data-list dim">
              {DATA_KEYS.map((k) => {
                let has = false
                try {
                  has = localStorage.getItem(k) != null
                } catch {
                  // 무시
                }
                return (
                  <li key={k}>
                    {has ? '✓' : '–'} {KEY_LABELS[k]}
                  </li>
                )
              })}
            </ul>
            <div className="data-actions">
              <button className="btn-ext" onClick={exportData}>
                ⬇ 파일로 내보내기
              </button>
              <button className="btn-ext" onClick={() => fileRef.current?.click()}>
                ⬆ 백업 파일 가져오기
              </button>
              <button className="btn-ext data-danger" onClick={reset}>
                전체 초기화
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importFile(f)
                e.target.value = ''
              }}
            />
            {message && <p className="hint">{message}</p>}
          </div>
        </div>
      )}
    </>
  )
}
