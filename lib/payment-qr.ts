/** Byte-mode QR codes for a single payment URL. Versions 1–6, error correction M. */

const GF_EXP = new Array<number>(512)
const GF_LOG = new Array<number>(256)

;(() => {
  let value = 1
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value
    GF_LOG[value] = i
    value <<= 1
    if (value & 0x100) value ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255]
})()

const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]])

type EcSpec = { data: number; ec: number; blocks: number }

/** Data and error-correction codewords per block for level M. */
const EC_M: Record<number, EcSpec> = {
  1: { data: 16, ec: 10, blocks: 1 },
  2: { data: 28, ec: 16, blocks: 1 },
  3: { data: 44, ec: 26, blocks: 1 },
  4: { data: 32, ec: 18, blocks: 2 },
  5: { data: 43, ec: 22, blocks: 2 },
  6: { data: 27, ec: 16, blocks: 4 },
}

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
}

const rsGenerator = (degree: number) => {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i])
    }
    poly = next
  }
  return poly
}

const rsRemainder = (data: number[], degree: number) => {
  const gen = rsGenerator(degree)
  const out = new Array(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ out[0]
    out.shift()
    out.push(0)
    if (factor !== 0) {
      for (let i = 0; i < degree; i += 1) out[i] ^= gfMul(gen[i + 1], factor)
    }
  }
  return out
}

export const paymentDataCodewords = (text: string, version: number) => {
  const spec = EC_M[version]
  const bytes = Array.from(new TextEncoder().encode(text))
  const bits: number[] = []
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, 8)
  for (const byte of bytes) push(byte, 8)
  const capacity = spec.data * spec.blocks * 8
  const terminator = Math.min(4, capacity - bits.length)
  push(0, terminator)
  while (bits.length % 8 !== 0) bits.push(0)
  const words: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let word = 0
    for (let b = 0; b < 8; b += 1) word = (word << 1) | bits[i + b]
    words.push(word)
  }
  const total = spec.data * spec.blocks
  let pad = 0
  while (words.length < total) {
    words.push(pad % 2 === 0 ? 0xec : 0x11)
    pad += 1
  }
  return words.slice(0, total)
}

const interleave = (data: number[], version: number) => {
  const spec = EC_M[version]
  const blocks: number[][] = []
  const ecs: number[][] = []
  for (let i = 0; i < spec.blocks; i += 1) {
    const slice = data.slice(i * spec.data, (i + 1) * spec.data)
    blocks.push(slice)
    ecs.push(rsRemainder(slice, spec.ec))
  }
  const out: number[] = []
  for (let i = 0; i < spec.data; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i])
  }
  for (let i = 0; i < spec.ec; i += 1) {
    for (const block of ecs) out.push(block[i])
  }
  return out
}

const sizeOf = (version: number) => 17 + version * 4

type Matrix = Array<Array<boolean | null>>

const blank = (size: number): Matrix => Array.from({ length: size }, () => Array<boolean | null>(size).fill(null))

const setFinder = (matrix: Matrix, row: number, col: number) => {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r
      const x = col + c
      if (y < 0 || x < 0 || y >= matrix.length || x >= matrix.length) continue
      const onEdge = r === -1 || c === -1 || r === 7 || c === 7
      const ring = r === 0 || c === 0 || r === 6 || c === 6
      matrix[y][x] = !onEdge && (ring || (r >= 2 && r <= 4 && c >= 2 && c <= 4))
    }
  }
}

const reserveFunctions = (matrix: Matrix, version: number) => {
  const size = matrix.length
  setFinder(matrix, 0, 0)
  setFinder(matrix, 0, size - 7)
  setFinder(matrix, size - 7, 0)
  for (let i = 8; i < size - 8; i += 1) {
    matrix[6][i] = i % 2 === 0
    matrix[i][6] = i % 2 === 0
  }
  const centers = ALIGNMENT[version]
  for (const row of centers) {
    for (const col of centers) {
      const overlapsFinder = (row < 9 && col < 9) || (row < 9 && col > size - 10) || (row > size - 10 && col < 9)
      if (overlapsFinder) continue
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          matrix[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1
        }
      }
    }
  }
  matrix[size - 8][8] = true
  for (let i = 0; i < 9; i += 1) {
    if (matrix[8][i] === null) matrix[8][i] = false
    if (matrix[i][8] === null) matrix[i][8] = false
  }
  for (let i = 0; i < 8; i += 1) {
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false
  }
}

const placeData = (matrix: Matrix, codewords: number[]) => {
  const size = matrix.length
  const bits: number[] = []
  for (const word of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push((word >> i) & 1)
  }
  let index = 0
  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (const dx of [0, -1]) {
        if (matrix[row][col + dx] !== null) continue
        matrix[row][col + dx] = index < bits.length ? bits[index] === 1 : false
        index += 1
      }
    }
    upward = !upward
  }
}

const formatBits = (mask: number) => {
  let data = mask & 0b111
  let rem = data << 10
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10)
  }
  return ((data << 10) | rem) ^ 0b101010000010010
}

const applyMask = (matrix: Matrix, mask: number) => {
  const size = matrix.length
  const out = matrix.map((row) => row.slice())
  const masked = (row: number, col: number) => {
    if (mask === 0) return (row + col) % 2 === 0
    if (mask === 1) return row % 2 === 0
    if (mask === 2) return col % 3 === 0
    if (mask === 3) return (row + col) % 3 === 0
    if (mask === 4) return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    if (mask === 5) return ((row * col) % 2) + ((row * col) % 3) === 0
    if (mask === 6) return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (functionModule(versionFromSize(size), row, col)) continue
      if (masked(row, col)) out[row][col] = !out[row][col]
    }
  }
  return out
}

const versionFromSize = (size: number) => (size - 17) / 4

const functionModule = (version: number, row: number, col: number) => {
  const size = sizeOf(version)
  const inFinder = (r: number, c: number) =>
    (r <= 8 && c <= 8) || (r <= 8 && c >= size - 8) || (r >= size - 8 && c <= 8)
  if (inFinder(row, col)) return true
  if (row === 6 || col === 6) return true
  if (row === 8 && col >= size - 8) return true
  if (col === 8 && row >= size - 7) return true
  const centers = ALIGNMENT[version]
  for (const r of centers) {
    for (const c of centers) {
      if (Math.abs(r - row) <= 2 && Math.abs(c - col) <= 2) {
        const finderCorner = (r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9)
        if (!finderCorner) return true
      }
    }
  }
  return false
}

const writeFormat = (matrix: Matrix, mask: number) => {
  const bits = formatBits(mask)
  const size = matrix.length
  for (let i = 0; i < 15; i += 1) {
    const on = ((bits >> i) & 1) === 1
    if (i < 6) matrix[i][8] = on
    else if (i < 8) matrix[i + 1][8] = on
    else matrix[size - 15 + i][8] = on
    if (i < 8) matrix[8][size - i - 1] = on
    else if (i < 9) matrix[8][15 - i - 1 + 1] = on
    else matrix[8][15 - i - 1] = on
  }
  matrix[size - 8][8] = true
}

const penalty = (matrix: Matrix) => {
  const size = matrix.length
  const dark = (row: number, col: number) => (matrix[row][col] === true ? 1 : 0)
  let score = 0
  for (let row = 0; row < size; row += 1) {
    let rowRun = 0
    let colRun = 0
    let lastRow = -1
    let lastCol = -1
    for (let col = 0; col < size; col += 1) {
      const rowBit = dark(row, col)
      if (rowBit === lastRow) rowRun += 1
      else {
        if (rowRun >= 5) score += 3 + (rowRun - 5)
        lastRow = rowBit
        rowRun = 1
      }
      const colBit = dark(col, row)
      if (colBit === lastCol) colRun += 1
      else {
        if (colRun >= 5) score += 3 + (colRun - 5)
        lastCol = colBit
        colRun = 1
      }
    }
    if (rowRun >= 5) score += 3 + (rowRun - 5)
    if (colRun >= 5) score += 3 + (colRun - 5)
  }
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const block = dark(row, col) + dark(row, col + 1) + dark(row + 1, col) + dark(row + 1, col + 1)
      if (block === 0 || block === 4) score += 3
    }
  }
  for (let row = 0; row < size; row += 1) {
    let bitsRow = 0
    let bitsCol = 0
    for (let col = 0; col < size; col += 1) {
      bitsRow = ((bitsRow << 1) & 0x7ff) | dark(row, col)
      bitsCol = ((bitsCol << 1) & 0x7ff) | dark(col, row)
      if (col >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) score += 40
      if (col >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) score += 40
    }
  }
  let darkCount = 0
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) darkCount += dark(row, col)
  }
  score += Math.abs(Math.ceil(darkCount * 100 / (size * size) / 5) - 10) * 10
  return score
}

const chooseVersion = (text: string) => {
  const length = new TextEncoder().encode(text).length
  for (let version = 1; version <= 6; version += 1) {
    const spec = EC_M[version]
    const capacity = spec.data * spec.blocks * 8
    const needed = 4 + 8 + length * 8
    if (needed <= capacity - 4) return version
  }
  throw new Error("Payment link is too long for a QR code")
}

export const buildPaymentQrMatrix = (text: string, mask?: number) => {
  const version = chooseVersion(text)
  const codewords = interleave(paymentDataCodewords(text, version), version)
  const base = blank(sizeOf(version))
  reserveFunctions(base, version)
  placeData(base, codewords)
  let bestMask = mask ?? 0
  let best = applyMask(base, bestMask)
  writeFormat(best, bestMask)
  if (mask === undefined) {
    let bestScore = penalty(best)
    for (let candidateMask = 1; candidateMask < 8; candidateMask += 1) {
      const candidate = applyMask(base, candidateMask)
      writeFormat(candidate, candidateMask)
      const score = penalty(candidate)
      if (score < bestScore) {
        best = candidate
        bestScore = score
        bestMask = candidateMask
      }
    }
  }
  return best.map((row) => row.map((cell) => cell === true))
}

export const paymentQrDataUrl = (text: string) => {
  const matrix = buildPaymentQrMatrix(text)
  const scale = 6
  const quiet = 4
  const size = (matrix.length + quiet * 2) * scale
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = "#111827"
  matrix.forEach((row, y) => {
    row.forEach((on, x) => {
      if (!on) return
      ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale)
    })
  })
  return canvas.toDataURL("image/png")
}
