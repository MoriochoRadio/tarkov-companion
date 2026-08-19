// Node 스크립트용 tarkov.dev JSON API 헬퍼 (웹의 src/api/jsonApi.ts와 같은 데이터원).
// GraphQL(api.tarkov.dev)이 2026-08-02부터 장기 장애라 json.tarkov.dev로 이전했다.
// 본문엔 "<id> Name" 같은 로케일 키가 들어 있고, `<데이터셋>_<lang>` 사전으로 치환한다.
const BASE = 'https://json.tarkov.dev'
const MODE = 'regular'

async function getJson(path, { retries = 5, timeoutMs = 30_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`tarkov.dev HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (attempt > retries) throw e
      const waitSec = Math.min(attempt * 10, 60)
      console.warn(`tarkov.dev ${path} 조회 실패(${e.message}) — ${waitSec}초 후 재시도`)
      await new Promise((r) => setTimeout(r, waitSec * 1000))
    }
  }
}

/**
 * 데이터셋 본문 + ko/en 로케일 사전을 함께 받는다.
 * @returns {Promise<{data: any, ko: Record<string,string>, en: Record<string,string>}>}
 */
export async function loadDataset(name, opts) {
  const path = `${MODE}/${name}`
  const [body, ko, en] = await Promise.all([
    getJson(path, opts),
    getJson(`${path}_ko`, opts),
    getJson(`${path}_en`, opts),
  ])
  return { data: body.data, ko: ko.data, en: en.data }
}

// 로케일 치환 — 없으면 다른 언어, 그것도 없으면 키 그대로 (upstream tarkov-dev와 같은 정책)
export const trKo = (d, key) => (key ? (d.ko[key] ?? d.en[key] ?? key).trim() : '')
export const trEn = (d, key) => (key ? (d.en[key] ?? d.ko[key] ?? key).trim() : '')
