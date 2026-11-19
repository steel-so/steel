/**
 * Catálogo de formatos de banner. Cada formato tem tamanho fixo (px) e,
 * quando a plataforma reserva faixas da tela (stories), uma área segura em
 * fração da altura.
 */

export type BannerFormatGroup =
  | 'google'
  | 'meta'
  | 'tiktok'
  | 'youtube'
  | 'social'

export const BANNER_FORMAT_GROUP_LABELS: Record<BannerFormatGroup, string> = {
  google: 'Google Display',
  meta: 'Meta / Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  social: 'Capas (Facebook e LinkedIn)',
}

export interface BannerFormatSpec {
  id: string
  group: BannerFormatGroup
  label: string
  width: number
  height: number
  /** Fração da altura reservada no topo e no rodapé (interface da rede). */
  safeTop: number
  safeBottom: number
  /** Peso alvo sugerido na exportação (KB), quando a plataforma limita. */
  targetKb: number | null
}

function spec(
  id: string,
  group: BannerFormatGroup,
  label: string,
  width: number,
  height: number,
  extra: Partial<
    Pick<BannerFormatSpec, 'safeTop' | 'safeBottom' | 'targetKb'>
  > = {},
): BannerFormatSpec {
  return {
    id,
    group,
    label,
    width,
    height,
    safeTop: extra.safeTop ?? 0,
    safeBottom: extra.safeBottom ?? 0,
    targetKb: extra.targetKb ?? null,
  }
}

const GDN = { targetKb: 150 }
const STORY = { safeTop: 0.13, safeBottom: 0.2 }

export const BANNER_FORMATS: BannerFormatSpec[] = [
  spec('gdn-300x250', 'google', 'Retângulo médio', 300, 250, GDN),
  spec('gdn-336x280', 'google', 'Retângulo grande', 336, 280, GDN),
  spec('gdn-728x90', 'google', 'Leaderboard', 728, 90, GDN),
  spec('gdn-970x90', 'google', 'Leaderboard grande', 970, 90, GDN),
  spec('gdn-970x250', 'google', 'Billboard', 970, 250, GDN),
  spec('gdn-160x600', 'google', 'Arranha-céu', 160, 600, GDN),
  spec('gdn-300x600', 'google', 'Meia página', 300, 600, GDN),
  spec('gdn-320x50', 'google', 'Mobile banner', 320, 50, GDN),
  spec('gdn-320x100', 'google', 'Mobile banner grande', 320, 100, GDN),
  spec('meta-1080x1080', 'meta', 'Feed quadrado', 1080, 1080),
  spec('meta-1080x1350', 'meta', 'Feed retrato', 1080, 1350),
  spec('meta-1080x1920', 'meta', 'Stories e Reels', 1080, 1920, STORY),
  spec('tiktok-1080x1920', 'tiktok', 'TikTok vertical', 1080, 1920, STORY),
  spec('yt-1280x720', 'youtube', 'Miniatura do YouTube', 1280, 720),
  spec('fb-cover-820x312', 'social', 'Capa do Facebook', 820, 312),
  spec('li-cover-1584x396', 'social', 'Capa do LinkedIn', 1584, 396),
]

const BY_ID = new Map(BANNER_FORMATS.map((format) => [format.id, format]))

export function findBannerFormat(id: string): BannerFormatSpec | undefined {
  return BY_ID.get(id)
}

/** "300 × 250" */
export function formatSize(format: { width: number; height: number }): string {
  return `${format.width} × ${format.height}`
}

export type BannerShape = 'strip' | 'wide' | 'square' | 'portrait' | 'tall'

/**
 * Família de proporção: o reflow proporcional só vale dentro da mesma
 * família; entre famílias o layout é refeito pelos papéis dos elementos.
 */
export function classifyShape(width: number, height: number): BannerShape {
  const ratio = width / height
  if (ratio >= 3) return 'strip'
  if (ratio >= 1.45) return 'wide'
  if (ratio >= 0.85) return 'square'
  if (ratio > 0.4) return 'portrait'
  return 'tall'
}

/** Formatos pré-selecionados ao criar um banner. */
export const DEFAULT_FORMAT_IDS = [
  'meta-1080x1080',
  'gdn-300x250',
  'gdn-728x90',
]
