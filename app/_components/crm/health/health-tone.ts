import type { CrmHealthLevelDTO } from '@/types/crm-health'

/**
 * Tons das faixas de risco do CRM (saúde do cliente e da oportunidade) - o
 * único lugar com cor da paleta nesta área, no mesmo padrão do `sd-tone.ts`
 * (as mesmas três faixas do risco preditivo do ServiceDesk). O resto usa
 * token semântico. Mapa fechado porque o Tailwind só gera as classes escritas
 * aqui.
 */

/** Chip com borda: selo do card e da lista. */
export const HEALTH_TONE: Record<CrmHealthLevelDTO, string> = {
  LOW: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  MEDIUM:
    'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  HIGH: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

/** Preenchimento sólido da barra de nota. */
export const HEALTH_FILL: Record<CrmHealthLevelDTO, string> = {
  LOW: 'bg-emerald-500',
  MEDIUM: 'bg-amber-500',
  HIGH: 'bg-rose-500',
}
