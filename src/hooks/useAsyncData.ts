import { useEffect, useState } from 'react'

type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

// 로딩/에러/완료 3단계를 공통 처리하는 훅
export function useAsyncData<T>(loader: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })

  useEffect(() => {
    let active = true
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
    // loader는 모듈 레벨 함수만 넘기므로 의존성에서 제외해도 안전
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
