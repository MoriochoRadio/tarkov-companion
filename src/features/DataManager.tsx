import { useEffect, useRef, useState } from 'react'

// 내 데이터 백업/복원 — 즐겨찾기·진행 중 퀘스트·체크리스트·은신처·알림이
// 전부 localStorage라 브라우저를 바꾸거나 캐시를 지우면 사라진다.
// 서버 없는 제약에서의 해답: JSON 파일로 내보내고 다른 기기에서 가져오기.
// "로그인 동기화"는 의도적으로 만들지 않음 — 서버 없는 로그인은 성립하지
// 않고, 무료 BaaS 의존은 한도·키 관리·개인정보 책임을 1인 프로젝트에
// 떠넘긴다 (2026-06 분석, 결론은 파일 백업 + 영구 저장 요청)

const LAST_EXPORT_KEY = 'tc:last-export' // 백업 파일에는 포함하지 않는 메타

const DATA_KEYS = [
  'tc:fav-items',
  'tc:active-quests',
  'tc:prep-counts',
  'tc:hideout-built',
  'tc:my-level',
  'tc:price-alerts',
  'tc:quest-item-marks',
  'tc:story-done',
  'tc:planner-picks',
] as const

const KEY_LABELS: Record<string, string> = {
  'tc:fav-items': '즐겨찾기',
  'tc:active-quests': '진행 중 퀘스트',
  'tc:prep-counts': '준비물 체크리스트',
  'tc:hideout-built': '은신처 건설 상태',
  'tc:my-level': '내 레벨',
  'tc:price-alerts': '가격 알림',
  'tc:quest-item-marks': '퀘스트 아이템 그리드 표시',
  'tc:story-done': '스토리 챕터 완료',
  'tc:planner-picks': '맵 플래너 선택',
}

// "몇 개 저장돼 있나" — 키마다 저장 형태가 달라 형태별로 센다
function countEntries(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return 0
    if (key === 'tc:my-level') return raw ? 1 : 0
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.length
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).length
    return 1
  } catch {
    return 0
  }
}

function lastExportLabel(): string {
  try {
    const t = localStorage.getItem(LAST_EXPORT_KEY)
    if (!t) return '백업한 적 없음'
    const days = Math.floor((Date.now() - Number(t)) / 86_400_000)
    if (days <= 0) return '오늘 백업함'
    return `마지막 백업 ${days}일 전`
  } catch {
    return ''
  }
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
  try {
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()))
  } catch {
    // 무시
  }
}

export function DataManager() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 다이얼로그를 열 때 영구 보관 상태 확인 + 미승인 시 한 번 더 요청
  useEffect(() => {
    if (!open || !navigator.storage?.persisted) return
    navigator.storage
      .persist()
      .then(setPersisted)
      .catch(() => setPersisted(null))
  }, [open])

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
              모든 진행도는 이 브라우저에 <strong>자동 저장</strong>됩니다 — 껐다
              켜도 유지. 사라지는 경우는 브라우저 데이터 삭제·시크릿 모드·다른
              기기뿐이니, 가끔 파일로 백업해 두면 안전합니다.
            </p>
            <ul className="data-list dim">
              {DATA_KEYS.map((k) => {
                const n = countEntries(k)
                return (
                  <li key={k}>
                    {n > 0 ? '✓' : '–'} {KEY_LABELS[k]}
                    {n > 0 && <span className="num"> {n}</span>}
                  </li>
                )
              })}
            </ul>
            <p className="hint data-status">
              {persisted === true &&
                '✓ 브라우저 영구 보관 승인됨 — 저장 공간 자동 정리 대상에서 제외'}
              {persisted === false &&
                '⚠ 저장 공간이 부족하면 브라우저가 지울 수 있는 상태 — 백업 권장'}
              {' · '}
              {lastExportLabel()}
            </p>
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
