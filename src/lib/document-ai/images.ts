import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFStream,
} from 'pdf-lib'

/**
 * Images of an uploaded PDF (AI import, ADR 0063): found where the page
 * content draws them (including inside form XObjects), decoded to a file the
 * browser opens (JPEG kept as is, raw pixels + soft mask re-encoded as PNG)
 * and described by page and position, so the model can put each one where
 * it was — an image block, a section background, a logo in the header.
 */

export interface ImagePlacement {
  /** 1-based page. */
  page: number
  /** Box as a fraction of the page; `y` counts from the top. */
  x: number
  y: number
  width: number
  height: number
}

export interface PdfImage {
  /** `img-1`… in reading order (page, then top to bottom). */
  id: string
  mime: 'image/jpeg' | 'image/png'
  /** Pixels of the source image. */
  width: number
  height: number
  bytes: Buffer
  placements: ImagePlacement[]
}

export const PDF_IMAGES_MAX_COUNT = 40
/** Same ceiling as the image library upload (`validateImage`). */
export const PDF_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PDF_IMAGES_MAX_TOTAL_BYTES = 30 * 1024 * 1024
/** Smaller than this (px, either side) is an icon or a rule, not content. */
const MIN_SIDE_PX = 24
/** A box smaller than this share of the page is decoration. */
const MIN_PAGE_SHARE = 0.002
const MAX_FORM_DEPTH = 6
const MAX_FORMS = 2000

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** `m1` applied first, then `m2` (PDF row-vector convention). */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ]
}

// ─── content stream scan ─────────────────────────────────────────────────

type Operand = number | string | null

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32])
const DELIMITERS = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)))
const isRegular = (code: number) =>
  !WHITESPACE.has(code) && !DELIMITERS.has(code)

/**
 * Calls `onOperator` for every operator of a content stream with the
 * operands before it (numbers, names as strings, anything else as null).
 * Inline images are skipped.
 */
export function scanOperators(
  source: Buffer,
  onOperator: (operator: string, operands: Operand[]) => void,
): void {
  const text = source.toString('latin1')
  let operands: Operand[] = []
  let i = 0
  const n = text.length
  const push = (value: Operand) => {
    operands.push(value)
    if (operands.length > 12) operands.shift()
  }
  while (i < n) {
    const code = text.charCodeAt(i)
    if (WHITESPACE.has(code)) {
      i++
    } else if (code === 0x25) {
      // % comment
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++
    } else if (code === 0x28) {
      // ( string )
      let depth = 1
      i++
      while (i < n && depth > 0) {
        const c = text[i]
        if (c === '\\') i++
        else if (c === '(') depth++
        else if (c === ')') depth--
        i++
      }
      push(null)
    } else if (code === 0x3c) {
      if (text[i + 1] === '<') {
        i += 2
      } else {
        while (i < n && text[i] !== '>') i++
        i++
        push(null)
      }
    } else if (code === 0x3e) {
      i += text[i + 1] === '>' ? 2 : 1
    } else if (DELIMITERS.has(code) && code !== 0x2f) {
      i++
    } else if (code === 0x2f) {
      let j = i + 1
      while (j < n && isRegular(text.charCodeAt(j))) j++
      push(decodeName(text.slice(i + 1, j)))
      i = j
    } else {
      let j = i
      while (j < n && isRegular(text.charCodeAt(j))) j++
      const word = text.slice(i, j)
      i = j
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
        push(Number(word))
      } else if (word === 'BI') {
        const end = /(^|[\0\t\n\f\r ])EI([\0\t\n\f\r ]|$)/.exec(text.slice(i))
        i = end ? i + end.index + end[0].length : n
        operands = []
      } else {
        onOperator(word, operands)
        operands = []
      }
    }
  }
}

/** `#xx` escapes of a PDF name. */
function decodeName(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
}

// ─── PDF objects ─────────────────────────────────────────────────────────

function streamBytes(stream: PDFStream): Buffer {
  if (stream instanceof PDFRawStream) {
    return Buffer.from(decodePDFRawStream(stream).decode())
  }
  return Buffer.from(stream.getContents())
}

function numberOf(value: unknown): number | undefined {
  return value instanceof PDFNumber ? value.asNumber() : undefined
}

function filterNames(dict: PDFDict): string[] | null {
  const filter = dict.lookup(PDFName.of('Filter'))
  if (!filter) return []
  if (filter instanceof PDFName) return [filter.decodeText()]
  if (filter instanceof PDFArray) {
    const names: string[] = []
    for (let i = 0; i < filter.size(); i++) {
      const item = filter.lookup(i)
      if (!(item instanceof PDFName)) return null
      names.push(item.decodeText())
    }
    return names
  }
  return null
}

/** Components per pixel of a color space, or null when unsupported. */
function componentsOf(space: unknown): number | null {
  if (space instanceof PDFName) {
    const name = space.decodeText()
    if (name === 'DeviceRGB' || name === 'CalRGB') return 3
    if (name === 'DeviceGray' || name === 'CalGray') return 1
    return null
  }
  if (space instanceof PDFArray) {
    const head = space.lookup(0)
    if (!(head instanceof PDFName)) return null
    const kind = head.decodeText()
    if (kind === 'ICCBased') {
      const profile = space.lookup(1)
      const dict =
        profile && 'dict' in profile ? (profile.dict as PDFDict) : null
      const count = numberOf(dict?.lookup(PDFName.of('N')))
      return count === 1 || count === 3 ? count : null
    }
    return componentsOf(head)
  }
  return null
}

interface DecodedImage {
  mime: 'image/jpeg' | 'image/png'
  width: number
  height: number
  bytes: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer)
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * Raw 8-bit pixels (1 or 3 components) plus an optional 8-bit alpha plane of
 * its own size, as a PNG. `step` > 1 samples every n-th pixel (smaller file).
 */
export function encodePng(input: {
  width: number
  height: number
  components: 1 | 3
  pixels: Uint8Array
  alpha?: { width: number; height: number; data: Uint8Array }
  step?: number
}): Buffer {
  const { components, pixels, alpha } = input
  const step = Math.max(1, input.step ?? 1)
  const width = Math.ceil(input.width / step)
  const height = Math.ceil(input.height / step)
  const channels = components + (alpha ? 1 : 0)
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(input.height - 1, y * step)
    const row = y * (stride + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const sx = Math.min(input.width - 1, x * step)
      const from = (sy * input.width + sx) * components
      const to = row + 1 + x * channels
      for (let c = 0; c < components; c++) raw[to + c] = pixels[from + c] ?? 0
      if (alpha) {
        const ax = Math.min(
          alpha.width - 1,
          Math.floor((sx / input.width) * alpha.width),
        )
        const ay = Math.min(
          alpha.height - 1,
          Math.floor((sy / input.height) * alpha.height),
        )
        raw[to + components] = alpha.data[ay * alpha.width + ax] ?? 255
      }
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  // 0 gray, 2 RGB, 4 gray + alpha, 6 RGB + alpha
  header[9] = components === 1 ? (alpha ? 4 : 0) : alpha ? 6 : 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** The soft mask of an image: 8-bit gray, Flate or raw. */
function softMask(
  image: PDFDict,
): { width: number; height: number; data: Uint8Array } | null {
  const ref = image.lookup(PDFName.of('SMask'))
  if (!(ref instanceof PDFRawStream)) return null
  const filters = filterNames(ref.dict)
  if (!filters || filters.some((name) => name !== 'FlateDecode')) return null
  const width = numberOf(ref.dict.lookup(PDFName.of('Width')))
  const height = numberOf(ref.dict.lookup(PDFName.of('Height')))
  const bits = numberOf(ref.dict.lookup(PDFName.of('BitsPerComponent'))) ?? 8
  if (!width || !height || bits !== 8) return null
  const data = streamBytes(ref)
  return data.length >= width * height ? { width, height, data } : null
}

function decodeImage(stream: PDFRawStream): DecodedImage | null {
  const dict = stream.dict
  const width = numberOf(dict.lookup(PDFName.of('Width')))
  const height = numberOf(dict.lookup(PDFName.of('Height')))
  if (!width || !height) return null
  if (dict.lookup(PDFName.of('ImageMask')) === PDFBool.True) return null
  const filters = filterNames(dict)
  if (!filters || filters.length > 1) return null
  const components = componentsOf(dict.lookup(PDFName.of('ColorSpace')))

  if (filters[0] === 'DCTDecode') {
    // CMYK JPEGs come inverted and browsers disagree on them: skip.
    if (components === null) return null
    const bytes = Buffer.from(stream.getContents())
    return bytes.length <= PDF_IMAGE_MAX_BYTES
      ? { mime: 'image/jpeg', width, height, bytes }
      : null
  }

  const bits = numberOf(dict.lookup(PDFName.of('BitsPerComponent')))
  if (filters.length === 1 && filters[0] !== 'FlateDecode') return null
  if (components === null || bits !== 8) return null
  if (width * height > 40_000_000) return null
  const pixels = streamBytes(stream)
  if (pixels.length < width * height * components) return null
  const alpha = softMask(dict) ?? undefined
  for (let step = 1; step <= 4; step *= 2) {
    const png = encodePng({
      width,
      height,
      components: components as 1 | 3,
      pixels,
      alpha,
      step,
    })
    if (png.length <= PDF_IMAGE_MAX_BYTES) {
      return {
        mime: 'image/png',
        width: Math.ceil(width / step),
        height: Math.ceil(height / step),
        bytes: png,
      }
    }
  }
  return null
}

// ─── extraction ──────────────────────────────────────────────────────────

interface Seen {
  decoded: DecodedImage | null
  placements: ImagePlacement[]
}

function pageStreams(page: ReturnType<PDFDocument['getPage']>): Buffer {
  const contents = page.node.Contents()
  if (!contents) return Buffer.alloc(0)
  if (contents instanceof PDFArray) {
    const parts: Buffer[] = []
    for (let i = 0; i < contents.size(); i++) {
      const item = contents.lookup(i)
      if (item instanceof PDFRawStream)
        parts.push(streamBytes(item), Buffer.from('\n'))
    }
    return Buffer.concat(parts)
  }
  return contents instanceof PDFRawStream
    ? streamBytes(contents)
    : Buffer.alloc(0)
}

function matrixOf(dict: PDFDict): Matrix {
  const array = dict.lookup(PDFName.of('Matrix'))
  if (!(array instanceof PDFArray) || array.size() !== 6) return IDENTITY
  const values = Array.from({ length: 6 }, (_, i) => numberOf(array.lookup(i)))
  return values.every((v): v is number => v !== undefined)
    ? (values as Matrix)
    : IDENTITY
}

function xobjects(resources: PDFDict | undefined): PDFDict | undefined {
  return resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
}

/**
 * Images drawn by the pages of a PDF, with their places. Never throws:
 * a file the parser cannot walk simply has no images.
 */
export async function extractPdfImages(buffer: Buffer): Promise<PdfImage[]> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(buffer, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    })
  } catch {
    return []
  }

  const seen = new Map<string, Seen>()
  let forms = 0

  const walk = (
    content: Buffer,
    resources: PDFDict | undefined,
    start: Matrix,
    pageNumber: number,
    box: { x: number; y: number; width: number; height: number },
    depth: number,
  ) => {
    const stack: Matrix[] = []
    let ctm = start
    scanOperators(content, (operator, operands) => {
      if (operator === 'q') stack.push(ctm)
      else if (operator === 'Q') ctm = stack.pop() ?? ctm
      else if (operator === 'cm' && operands.length >= 6) {
        const m = operands.slice(-6)
        if (m.every((v): v is number => typeof v === 'number')) {
          ctm = multiply(m as Matrix, ctm)
        }
      } else if (operator === 'Do') {
        const name = operands[operands.length - 1]
        if (typeof name !== 'string') return
        const key = PDFName.of(name)
        const table = xobjects(resources)
        const object = table?.lookup(key)
        if (!(object instanceof PDFRawStream)) return
        const subtype = object.dict.lookup(PDFName.of('Subtype'))
        if (subtype === PDFName.of('Form')) {
          if (depth >= MAX_FORM_DEPTH || ++forms > MAX_FORMS) return
          const own = object.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)
          walk(
            streamBytes(object),
            own ?? resources,
            multiply(matrixOf(object.dict), ctm),
            pageNumber,
            box,
            depth + 1,
          )
          return
        }
        if (subtype !== PDFName.of('Image')) return
        const ref = table?.get(key)
        const id = ref instanceof PDFRef ? ref.tag : `${pageNumber}:${name}`
        let entry = seen.get(id)
        if (!entry) {
          entry = { decoded: decodeImage(object), placements: [] }
          seen.set(id, entry)
        }
        if (!entry.decoded) return
        entry.placements.push(placementOf(ctm, pageNumber, box))
      }
    })
  }

  doc.getPages().forEach((page, index) => {
    const mediaBox = page.getMediaBox()
    if (!(mediaBox.width > 0 && mediaBox.height > 0)) return
    try {
      walk(
        pageStreams(page),
        page.node.Resources(),
        IDENTITY,
        index + 1,
        mediaBox,
        0,
      )
    } catch {
      // A page that cannot be walked just contributes no image.
    }
  })

  return collect(seen)
}

function placementOf(
  ctm: Matrix,
  page: number,
  box: { x: number; y: number; width: number; height: number },
): ImagePlacement {
  const [a, b, c, d, e, f] = ctm
  const xs = [e, e + a, e + c, e + a + c]
  const ys = [f, f + b, f + d, f + b + d]
  // Clipped to the page: a picture bleeding off the edge reads as full width.
  const minX = Math.max(box.x, Math.min(...xs))
  const maxX = Math.min(box.x + box.width, Math.max(...xs))
  const minY = Math.max(box.y, Math.min(...ys))
  const maxY = Math.min(box.y + box.height, Math.max(...ys))
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    page,
    x: round((minX - box.x) / box.width),
    y: round(1 - (maxY - box.y) / box.height),
    width: round(Math.max(0, maxX - minX) / box.width),
    height: round(Math.max(0, maxY - minY) / box.height),
  }
}

function collect(seen: Map<string, Seen>): PdfImage[] {
  // The same picture drawn from several objects counts once.
  const byHash = new Map<string, Omit<PdfImage, 'id'>>()
  for (const entry of seen.values()) {
    const decoded = entry.decoded
    if (!decoded) continue
    if (Math.min(decoded.width, decoded.height) < MIN_SIDE_PX) continue
    const placements = entry.placements.filter(
      (p) => p.width * p.height >= MIN_PAGE_SHARE,
    )
    if (placements.length === 0) continue
    const hash = createHash('sha1').update(decoded.bytes).digest('hex')
    const known = byHash.get(hash)
    if (known) known.placements.push(...placements)
    else byHash.set(hash, { ...decoded, placements: [...placements] })
  }

  const first = (image: Omit<PdfImage, 'id'>) =>
    [...image.placements].sort((a, b) => a.page - b.page || a.y - b.y)[0]
  const ordered = [...byHash.values()].sort((a, b) => {
    const pa = first(a)
    const pb = first(b)
    return (
      (pa?.page ?? 0) - (pb?.page ?? 0) ||
      (pa?.y ?? 0) - (pb?.y ?? 0) ||
      (pa?.x ?? 0) - (pb?.x ?? 0)
    )
  })

  const images: PdfImage[] = []
  let total = 0
  for (const image of ordered) {
    if (images.length >= PDF_IMAGES_MAX_COUNT) break
    if (total + image.bytes.length > PDF_IMAGES_MAX_TOTAL_BYTES) continue
    total += image.bytes.length
    images.push({ ...image, id: `img-${images.length + 1}` })
  }
  return images
}

// ─── description for the model ───────────────────────────────────────────

const percent = (value: number) => `${Math.round(value * 100)}%`

function area(placement: ImagePlacement): string {
  const { x, y, width, height } = placement
  const vertical =
    y + height / 2 < 0.34 ? 'top' : y + height / 2 > 0.66 ? 'bottom' : 'middle'
  const horizontal =
    x + width / 2 < 0.34 ? 'left' : x + width / 2 > 0.66 ? 'right' : 'center'
  return `${vertical} ${horizontal}, ${percent(width)} of the page width and ${percent(height)} of its height`
}

/** Covers (nearly) the whole page: a background or a full-page picture. */
export function isFullPage(placement: ImagePlacement): boolean {
  return placement.width >= 0.85 && placement.height >= 0.85
}

/** A picture that comes back on many pages: header, footer or watermark. */
export function isRepeated(image: PdfImage, pageCount: number): boolean {
  const pages = new Set(image.placements.map((p) => p.page))
  return pages.size >= 3 && pages.size >= Math.ceil(pageCount / 2)
}

/** The list the model reads next to the file. */
export function describeImages(images: PdfImage[], pageCount: number): string {
  if (images.length === 0) return ''
  const lines = images.map((image) => {
    const pages = [...new Set(image.placements.map((p) => p.page))]
    const first = [...image.placements].sort(
      (a, b) => a.page - b.page || a.y - b.y,
    )[0]
    const notes: string[] = []
    if (first && isFullPage(first))
      notes.push('covers the whole page (background)')
    if (isRepeated(image, pageCount)) {
      notes.push(
        `repeats on pages ${pages.join(', ')} (page header/footer/watermark)`,
      )
    } else if (pages.length > 1) {
      notes.push(`also on pages ${pages.slice(1).join(', ')}`)
    }
    return `- ${image.id}: page ${first?.page ?? 1}, ${first ? area(first) : ''}; ${image.width}x${image.height} px${notes.length ? `; ${notes.join('; ')}` : ''}`
  })
  return [
    'Images extracted from the file (their ids go in `imageId`, `backgroundImageId` and the `page` fields):',
    ...lines,
  ].join('\n')
}
