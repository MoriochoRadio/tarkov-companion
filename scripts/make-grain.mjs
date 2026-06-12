// 필름 그레인 타일(PNG 1장) 생성 — 의존성 없이 zlib만으로 PNG 인코딩.
// 결과물은 src/assets/grain.png (CSS에서 반복 타일로 사용, 런타임 비용 0).
// 사용: node scripts/make-grain.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 120 // 타일 한 변(px) — 작을수록 반복이 눈에 띄고 클수록 파일이 큼

// CRC32 (PNG 청크 체크섬)
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// IHDR: 8bit, color type 4 (grayscale + alpha)
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 4

// 스캔라인: 행마다 필터 0 + (밝기, 알파).
// 균일 노이즈는 압축이 안 되고(랜덤 데이터) 화면도 탁해짐 — 픽셀 70%는 완전 투명,
// 나머지만 밝거나 어두운 스펙클로 두면 파일도 작고 필름 그레인 질감에 더 가깝다
const raw = Buffer.alloc(SIZE * (1 + SIZE * 2))
let off = 0
for (let y = 0; y < SIZE; y++) {
  raw[off++] = 0
  for (let x = 0; x < SIZE; x++) {
    if (Math.random() < 0.7) {
      raw[off++] = 0
      raw[off++] = 0
    } else {
      raw[off++] = Math.random() < 0.5 ? 0 : 255 // 어두운 점 / 밝은 점
      raw[off++] = 48 + Math.floor(Math.random() * 4) * 40 // 48·88·128·168 4단계
    }
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/grain.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`grain.png 생성: ${out} (${(png.length / 1024).toFixed(1)}KB)`)
