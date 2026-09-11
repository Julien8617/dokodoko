// Générateur ponctuel d'icônes placeholder (carré uni) pour amorcer le
// manifeste PWA. À remplacer par de vraies icônes avant la mise en service
// réelle du pilote — ceci n'est qu'un repère visuel pour le développement.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function solidSquarePng(size, [r, g, b]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowLength = size * 3
  const raw = Buffer.alloc((rowLength + 1) * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowLength + 1)
    raw[rowStart] = 0 // no filter
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
    }
  }
  const idat = deflateSync(raw)

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync('public/icons', { recursive: true })
const color = [0x11, 0x11, 0x11]
writeFileSync('public/icons/icon-192.png', solidSquarePng(192, color))
writeFileSync('public/icons/icon-512.png', solidSquarePng(512, color))
writeFileSync('public/icons/apple-touch-icon.png', solidSquarePng(180, color))
console.log('Icônes placeholder générées dans public/icons/')
