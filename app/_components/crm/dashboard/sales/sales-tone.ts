/**
 * Tons do kit de Vendas — o único lugar com cor da paleta neste módulo
 * (mesmo padrão do `sd-tone.ts` do ServiceDesk). O resto usa token
 * semântico (`primary`, `muted`, `card`, `destructive`…). Mapa fechado
 * também porque o Tailwind só gera as classes escritas aqui.
 */
export type SalesTone = 'up' | 'down' | 'gold' | 'silver' | 'bronze' | 'warn'

/** Texto do tom (números de ritmo, tendência). */
export const SALES_TONE_TEXT: Record<SalesTone, string> = {
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-red-600 dark:text-red-400',
  gold: 'text-amber-600 dark:text-amber-300',
  silver: 'text-slate-600 dark:text-slate-300',
  bronze: 'text-orange-700 dark:text-orange-300',
  warn: 'text-amber-700 dark:text-amber-300',
}

/** Fundo translúcido + texto (chips, medalhas). */
export const SALES_TONE: Record<SalesTone, string> = {
  up: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  down: 'bg-red-500/15 text-red-700 dark:text-red-300',
  gold: 'bg-amber-400/20 text-amber-700 dark:text-amber-200',
  silver: 'bg-slate-400/20 text-slate-700 dark:text-slate-200',
  bronze: 'bg-orange-500/15 text-orange-800 dark:text-orange-200',
  warn: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
}

/** Preenchimento sólido (barras de progresso). */
export const SALES_TONE_FILL: Record<SalesTone, string> = {
  up: 'bg-emerald-500',
  down: 'bg-red-500',
  gold: 'bg-amber-400',
  silver: 'bg-slate-400',
  bronze: 'bg-orange-500',
  warn: 'bg-amber-500',
}

/** Anel em volta da foto do pódio. */
export const SALES_TONE_RING: Record<SalesTone, string> = {
  up: 'ring-emerald-500',
  down: 'ring-red-500',
  gold: 'ring-amber-400',
  silver: 'ring-slate-400',
  bronze: 'ring-orange-500',
  warn: 'ring-amber-500',
}

/** Tom do pódio pela posição (1º ouro, 2º prata, 3º bronze). */
export function podiumTone(position: number): SalesTone | null {
  if (position === 1) return 'gold'
  if (position === 2) return 'silver'
  if (position === 3) return 'bronze'
  return null
}
