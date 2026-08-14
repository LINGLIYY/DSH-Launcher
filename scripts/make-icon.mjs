/**
 * 生成 build/icon.png（256×256）—— 终端提示符主题：
 * 深色圆角方块 + 蓝色 ">" 提示符 + 白色块状光标。
 * 纯 Node（zlib）手写 PNG 编码，无任何依赖。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const RADIUS = 56
const px = new Uint8Array(SIZE * SIZE * 4) // RGBA

// ── 基础图形 ───────────────────────────────────────────────
function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.max(x0 + r, Math.min(x, x1 - r))
  const cy = Math.max(y0 + r, Math.min(y, y1 - r))
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function setPixel(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
}

function fillRoundRect(x0, y0, x1, y1, r, color) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (insideRoundRect(x, y, x0, y0, x1, y1, r)) setPixel(x, y, color)
    }
  }
}

/** 线段描边（点到线段距离 < halfWidth 即上色）。 */
function strokeSegment(x0, y0, x1, y1, halfWidth, color) {
  const dx = x1 - x0
  const dy = y1 - y0
  const lenSq = dx * dx + dy * dy
  const xMin = Math.max(0, Math.floor(Math.min(x0, x1) - halfWidth - 1))
  const xMax = Math.min(SIZE - 1, Math.ceil(Math.max(x0, x1) + halfWidth + 1))
  const yMin = Math.max(0, Math.floor(Math.min(y0, y1) - halfWidth - 1))
  const yMax = Math.min(SIZE - 1, Math.ceil(Math.max(y0, y1) + halfWidth + 1))
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      let t = lenSq === 0 ? 0 : ((x - x0) * dx + (y - y0) * dy) / lenSq
      t = Math.max(0, Math.min(1, t))
      const px0 = x0 + t * dx - x
      const py0 = y0 + t * dy - y
      if (px0 * px0 + py0 * py0 <= halfWidth * halfWidth) setPixel(x, y, color)
    }
  }
}

// ── 绘制 ───────────────────────────────────────────────────
const BG = [16, 21, 30, 255]        // #10151e 深色底
const ACCENT = [77, 141, 255, 255]  // #4d8dff
const WHITE = [230, 233, 238, 255]  // #e6e9ee

fillRoundRect(8, 8, SIZE - 9, SIZE - 9, RADIUS, BG)

// 提示符 ">"
strokeSegment(84, 96, 132, 128, 8, ACCENT)
strokeSegment(132, 128, 84, 160, 8, ACCENT)

// 块状光标 "_"
strokeSegment(150, 168, 196, 168, 9, WHITE)

// 底部小圆点（托盘尺寸下可辨识的锚点）
fillRoundRect(108, 184, 148, 190, 3, ACCENT)

// ── PNG 编码 ───────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

// 每行：filter byte(0) + RGBA
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4)
  raw[rowStart] = 0
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, rowStart + 1)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8  // bit depth
ihdr[9] = 6  // color type RGBA
// compression/filter/interlace = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const outPath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'build', 'icon.png')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, png)
console.log(`icon 已生成: ${outPath} (${png.length} bytes)`)
