// 브리핑에 그대로 싣는 원문(주로 Reddit 제목·발췌)의 욕설 단어 마스킹.
// 번역·요약을 하지 않고 원문을 그대로 보여 주므로(Phase 45) 욕설도 그대로 노출됐다
// (2026-08~09 브리핑 678건 중 18건). 첫 글자만 남기고 나머지를 *로 가린다: fucking → f******
//
// 단어 경계(\b)로만 잡아 Shturman·Scunthorpe 같은 정상 단어는 건드리지 않는다.
const PROFANITY =
  /\b(?:\w*fuck\w*|(?:bull)?shit(?:s|ty|ter|ters|ting|ted|head|heads|show|post|posting)?|bitch(?:es|ing|y)?|cunts?|assholes?|retard(?:s|ed)?|fag(?:s|got|gots)?|nigg\w*)\b/gi

export function maskProfanity(text) {
  if (typeof text !== 'string') return text
  return text.replace(PROFANITY, (w) => w[0] + '*'.repeat(w.length - 1))
}
