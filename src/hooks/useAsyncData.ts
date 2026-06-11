import { useEffect, useState } from 'react'

type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

// 로딩/에러/완료 3단계를 공통 처리하는 훅.
// deps가 바뀌면 다시 로딩 (예: 브리핑 날짜 선택)
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
