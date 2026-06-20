import { useCallback, useEffect, useMemo, useState } from 'react'

type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

// 반환값엔 reload가 합쳐진다 — 에러 시 "다시 시도"로 새로고침 없이 재요청.
// status로 좁히면 data/message 접근은 그대로 동작(교집합 타입이라 호환).
export type AsyncResult<T> = AsyncState<T> & { reload: () => void }

// 로딩/에러/완료 3단계를 공통 처리하는 훅.
// deps가 바뀌면 다시 로딩 (예: 브리핑 날짜 선택)
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  // reload는 nonce를 올려 effect를 다시 돌린다 (네트워크 일시 오류 복구용)
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    loader()
      .then((data) => {
        if (active) setState({ status: 'ready', data })
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      active = false
    }
    // loader 자체는 의존성에서 제외 — 호출부가 deps로 갱신 시점을 명시함
    // nonce가 바뀌면(=reload 호출) 다시 로딩
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  // 참조 안정성 유지 — state가 바뀔 때만 새 객체. 일부 탭이 [state]를 useMemo
  // 의존성으로 쓰므로 매 렌더 새 객체를 주면 불필요한 재계산이 생긴다
  return useMemo(() => ({ ...state, reload }), [state, reload])
}
