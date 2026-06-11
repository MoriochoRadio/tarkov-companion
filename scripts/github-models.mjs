// GitHub Models 호출 공용 헬퍼 — 호출 횟수 로깅 + 상한 안전장치
// 무료 한도(하루 50회)의 절반 이하만 쓰는 게 원칙이며,
// 버그로 인한 폭주를 막기 위해 프로세스당 MAX_CALLS회에서 강제 차단한다.
// 기본 20, 워크플로우별로 MODELS_MAX_CALLS 환경변수로 조정
// (quest-guides는 30 — 브리핑 5회·주간 1회와 합쳐도 무료 한도 50회/일 이내)
const MAX_CALLS = Number(process.env.MODELS_MAX_CALLS ?? 20)
export { MAX_CALLS }
// 1순위 실패(미지원/한도 초과) 시 다음 모델로
export const MODELS = ['openai/gpt-4.1-mini', 'openai/gpt-4o-mini']

let callCount = 0

export function getCallCount() {
  return callCount
}

/**
 * 단일 모델 호출. JSON 객체 응답을 기대한다.
 * @param {object} opts
 * @param {string} opts.model - 모델 ID
 * @param {string} opts.system - 시스템 프롬프트
 * @param {string} opts.user - 사용자 메시지
 * @param {string} opts.token - GITHUB_TOKEN
 * @param {string} opts.purpose - 로그에 남길 호출 목적
 * @returns {Promise<string>} 모델 응답 텍스트
 */
export async function callModel({ model, system, user, token, purpose }) {
  if (callCount >= MAX_CALLS) {
    throw new Error(`API 호출 상한(${MAX_CALLS}회) 도달 — 호출 차단`)
  }
  callCount += 1
  console.log(`[models] 호출 ${callCount}/${MAX_CALLS}: ${purpose} (${model})`)

  const res = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  const usage = data.usage
    ? ` (토큰 in ${data.usage.prompt_tokens}/out ${data.usage.completion_tokens})`
    : ''
  console.log(`[models] 응답 수신: ${purpose}${usage}`)
  return data.choices[0].message.content
}

/**
 * 모델 폴백 포함 호출 + JSON 파싱. 모든 모델이 실패하면 throw.
 * @param {(parsed: any) => any} validate - 파싱된 JSON 검증/정규화 (실패 시 throw)
 */
export async function callWithFallback({ system, user, token, purpose, validate }) {
  let lastError = null
  for (const model of MODELS) {
    try {
      const text = await callModel({ model, system, user, token, purpose })
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/```\s*$/, '')
      return validate(JSON.parse(cleaned))
    } catch (err) {
      lastError = err
      console.error(`[models] ✗ ${purpose} 실패 (${model}): ${err}`)
    }
  }
  throw lastError ?? new Error(`${purpose}: 사용 가능한 모델 없음`)
}
