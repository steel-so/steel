import { emitNotification } from './notification-emitter'

/**
 * Inbox notice at the end of a bulk CNPJ enrichment run (fire-and-forget like
 * every emitter: it never fails the run). Goes to whoever started the run.
 */

export const CRM_CNPJ_COMPANIES_PATH = '/crm/companies'

type FinishedStatus = 'COMPLETED' | 'FAILED' | 'CANCELED'

const TITLES: Record<FinishedStatus, string> = {
  COMPLETED: 'Enriquecimento de empresas concluído',
  FAILED: 'Enriquecimento de empresas falhou',
  CANCELED: 'Enriquecimento de empresas cancelado',
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export function notifyCnpjRunFinished(input: {
  workspaceId: string
  runId: string
  createdById: string
  status: FinishedStatus
  total: number
  processed: number
  enriched: number
  notFound: number
  invalid: number
  failed: number
  error?: string | null
}): Promise<number> {
  const parts = [
    `Consultadas ${input.processed} de ${plural(input.total, 'empresa', 'empresas')}`,
    plural(input.enriched, 'atualizada', 'atualizadas'),
  ]
  const missing = input.notFound + input.invalid
  if (missing > 0) parts.push(`${missing} sem registro na Receita`)
  if (input.failed > 0) parts.push(plural(input.failed, 'falha', 'falhas'))
  const body =
    input.status === 'FAILED' && input.error
      ? input.error.slice(0, 280)
      : `${parts.join(' · ')}.`
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.createdById],
    kind: 'CRM_CNPJ_ENRICHMENT_FINISHED',
    title: TITLES[input.status],
    body,
    path: CRM_CNPJ_COMPANIES_PATH,
    dedupeKey: `crm-cnpj-run:${input.runId}`,
  })
}
