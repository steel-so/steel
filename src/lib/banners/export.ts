import type { BannerFormat } from '@/src/schemas/crm-banner.schema'
import { type BannerImageCache, imageSources, renderFormat } from './render'

export type BannerExportType = 'png' | 'jpeg' | 'webp'

export const EXPORT_TYPE_LABELS: Record<BannerExportType, string> = {
  png: 'PNG',
  jpeg: 'JPG',
  webp: 'WebP',
}

export const EXPORT_MIME: Record<BannerExportType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const EXPORT_EXTENSION: Record<BannerExportType, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
}

/* --------------------------------- names --------------------------------- */

/** File-name friendly version of a banner name. */
export function slugifyName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'banner'
}

export function exportFileName(
  bannerName: string,
  format: { width: number; height: number },
  type: BannerExportType,
): string {
  return `${slugifyName(bannerName)}-${format.width}x${format.height}.${EXPORT_EXTENSION[type]}`
}

/* ------------------------- quality search (peso alvo) ------------------------- */

export interface FitResult {
  blob: Blob
  quality: number
  /** `false` when even the lowest quality is above the target. */
  fits: boolean
}

/**
 * Finds the highest quality whose file stays within `targetBytes` (binary
 * search over `encode`). Returns the smallest attempt when none fits.
 */
export async function fitQuality(
  encode: (quality: number) => Promise<Blob>,
  targetBytes: number,
  options: { min?: number; max?: number; steps?: number } = {},
): Promise<FitResult> {
  const min = options.min ?? 0.3
  const max = options.max ?? 0.95
  const steps = options.steps ?? 7

  const best = await encode(max)
  if (best.size <= targetBytes) return { blob: best, quality: max, fits: true }

  const worst = await encode(min)
  if (worst.size > targetBytes) {
    return { blob: worst, quality: min, fits: false }
  }

  let low = min
  let high = max
  let chosen: FitResult = { blob: worst, quality: min, fits: true }
  for (let i = 0; i < steps; i += 1) {
    const mid = (low + high) / 2
    const blob = await encode(mid)
    if (blob.size <= targetBytes) {
      chosen = { blob, quality: mid, fits: true }
      low = mid
    } else {
      high = mid
    }
  }
  return chosen
}

/* ---------------------------------- ZIP ---------------------------------- */

let crcTable: Uint32Array | null = null

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      crcTable[n] = c >>> 0
    }
  }
  const table = crcTable
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipFile {
  name: string
  data: Uint8Array
}

/**
 * ZIP with stored (uncompressed) entries: banners are already compressed
 * images, so deflate would only cost time. Names are UTF-8.
 */
export function createStoredZip(files: ZipFile[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const checksum = crc32(file.data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0x21, true) // 1980-01-01
    lv.setUint32(14, checksum, true)
    lv.setUint32(18, file.data.length, true)
    lv.setUint32(22, file.data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, checksum, true)
    cv.setUint32(20, file.data.length, true)
    cv.setUint32(24, file.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)

    locals.push(local, file.data)
    centrals.push(central)
    offset += local.length + file.data.length
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

/** Appends " (2)", " (3)"… to repeated names inside one archive. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    if (count === 0) return name
    const dot = name.lastIndexOf('.')
    return dot > 0
      ? `${name.slice(0, dot)} (${count + 1})${name.slice(dot)}`
      : `${name} (${count + 1})`
  })
}

/* ------------------------------ browser side ------------------------------ */

export interface RenderedBanner {
  blob: Blob
  type: BannerExportType
  width: number
  height: number
  quality: number | null
  /** `false` when a target weight was set and could not be met. */
  fits: boolean
  /** Images that could not be read (left out of the picture). */
  missingImages: string[]
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: BannerExportType,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem')),
      EXPORT_MIME[type],
      quality,
    )
  })
}

/** Renders one format at its real size and encodes it. */
export async function renderBannerToBlob(
  format: BannerFormat,
  cache: BannerImageCache,
  options: { type: BannerExportType; targetKb: number | null },
): Promise<RenderedBanner> {
  const sources = imageSources(format)
  await Promise.all(sources.map((src) => cache.load(src)))
  const images = cache.ready()
  const missingImages = sources.filter((src) => !images.has(src))

  const canvas = document.createElement('canvas')
  canvas.width = format.width
  canvas.height = format.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Seu navegador não conseguiu desenhar o banner')
  if (options.type === 'jpeg') {
    // JPG has no alpha: start from white.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  renderFormat(ctx, format, { scale: 1, images })

  const base = {
    type: options.type,
    width: format.width,
    height: format.height,
    missingImages,
  }

  if (options.type === 'png') {
    const blob = await canvasToBlob(canvas, 'png')
    const fits =
      options.targetKb === null || blob.size <= options.targetKb * 1024
    return { ...base, blob, quality: null, fits }
  }
  if (options.targetKb === null) {
    const blob = await canvasToBlob(canvas, options.type, 0.92)
    return { ...base, blob, quality: 0.92, fits: true }
  }
  const type = options.type
  const result = await fitQuality(
    (quality) => canvasToBlob(canvas, type, quality),
    options.targetKb * 1024,
  )
  return {
    ...base,
    blob: result.blob,
    quality: result.quality,
    fits: result.fits,
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** "120 KB" / "1.4 MB" */
export function formatKb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
