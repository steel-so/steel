import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'
import type {
  AiProcedureRunStatusDTO,
  AiProcedureStatusDTO,
} from '@/types/ai-procedure'

export const STEP_KIND_LABEL: Record<ProcedureStep['kind'], string> = {
  COLLECT: 'Pedir um dado ao cliente',
  HTTP: 'Consultar um endereço (HTTPS)',
  TOOL: 'Usar uma ferramenta de leitura',
  MESSAGE: 'Enviar uma mensagem',
  HANDOFF: 'Transferir para um atendente',
}

export const PROCEDURE_STATUS_LABEL: Record<AiProcedureStatusDTO, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativo',
  ARCHIVED: 'Arquivado',
}

export const RUN_STATUS_LABEL: Record<AiProcedureRunStatusDTO, string> = {
  RUNNING: 'Em andamento',
  COMPLETED: 'Concluído',
  FAILED: 'Falhou (humano assumiu)',
  HANDED_OFF: 'Transferido',
  CANCELED: 'Cancelado',
}

export const SUBJECT_LABEL = {
  WHATSAPP_CONVERSATION: 'Conversa do WhatsApp',
  STEEL_AGENT_RUN: 'Execução de agente',
  TEST: 'Teste',
} as const

export const OPERATOR_LABEL: Record<string, string> = {
  equals: 'é igual a',
  not_equals: 'é diferente de',
  contains: 'contém',
  not_contains: 'não contém',
  greater_than: 'é maior que',
  less_than: 'é menor que',
  is_empty: 'está vazio',
  is_not_empty: 'não está vazio',
}

export const VALIDATION_LABEL: Record<string, string> = {
  TEXT: 'Texto livre',
  NUMBER: 'Número',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  DATE: 'Data',
}

export const OPERATORS_WITHOUT_VALUE = new Set(['is_empty', 'is_not_empty'])

export function formatProcedureDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(iso))
}

/** Next free `passo_<n>` key. */
export function nextStepKey(steps: readonly { key: string }[]): string {
  const used = new Set(steps.map((s) => s.key))
  let n = steps.length + 1
  while (used.has(`passo_${n}`)) n++
  return `passo_${n}`
}

export function blankStep(
  kind: ProcedureStep['kind'],
  key: string,
  title = '',
): ProcedureStep {
  const base = { key, title, required: true, condition: null }
  switch (kind) {
    case 'COLLECT':
      return {
        ...base,
        kind,
        variable: key,
        prompt: '',
        validation: 'TEXT',
      }
    case 'HTTP':
      return { ...base, kind, method: 'GET', url: 'https://', saves: [] }
    case 'TOOL':
      return { ...base, kind, toolName: '', args: {}, saves: [] }
    case 'MESSAGE':
      return { ...base, kind, text: '' }
    case 'HANDOFF':
      return { ...base, kind, text: '' }
  }
}
