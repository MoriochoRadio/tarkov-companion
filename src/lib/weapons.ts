// 3D 무기 쇼케이스 목록 — 모델은 전부 Quaternius 제작 CC0 (public/models/LICENSE.md)
// ※ 타르코프 게임 추출 에셋 아님
export interface WeaponDef {
  id: string
  name: string
  file: string
  poster: string // 3D를 못 쓰는 환경(모바일/저사양/WebGL 미지원)용 사전 렌더 이미지
}

const BASE = import.meta.env.BASE_URL

export const WEAPONS: WeaponDef[] = [
  {
    id: 'ak47',
    name: 'AK-47',
    file: `${BASE}models/ak47.glb`,
    poster: `${BASE}models/poster-ak47.png`,
  },
  {
    id: 'assault-rifle',
    name: '돌격소총',
    file: `${BASE}models/assault-rifle.glb`,
    poster: `${BASE}models/poster-assault-rifle.png`,
  },
]

export const WEAPON_CREDIT = {
  text: '3D 모델: Quaternius (CC0)',
  url: 'https://quaternius.com',
}
