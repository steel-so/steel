import type {
  CrmWorkflowDelayUnit,
  CrmWorkflowEntity,
  CrmWorkflowFilterOperator,
  CrmWorkflowFormFieldType,
  CrmWorkflowNodeType,
  CrmWorkflowRunStatus,
  CrmWorkflowRunStepStatus,
  CrmWorkflowTriggerType,
} from '@/src/schemas/crm-workflow.schema'

/**
 * pt-BR labels for every enum the workflow editor and the runs drawer show.
 * The wire values stay in English (they are the API contract); only what the
 * user reads is translated here, in one place.
 */

export const WORKFLOW_TRIGGER_LABELS: Record<CrmWorkflowTriggerType, string> = {
  'record-is-created': 'Registro criado',
  'record-is-updated': 'Registro atualizado',
  'record-is-deleted': 'Registro excluído',
  'record-is-created-or-updated': 'Registro criado/atualizado',
  'launch-manually': 'Disparo manual',
  'on-a-schedule': 'Agendado',
  webhook: 'Webhook',
}

export const WORKFLOW_NODE_LABELS: Record<CrmWorkflowNodeType, string> = {
  'create-record': 'Criar registro',
  'update-record': 'Atualizar registro',
  'delete-record': 'Excluir registro',
  'search-records': 'Buscar registros',
  'create-or-update-record': 'Criar ou atualizar registro',
  iterator: 'Iterar',
  filter: 'Filtro',
  'if-else': 'Se / senão',
  delay: 'Atraso',
  'send-email': 'Enviar e-mail',
  'draft-email': 'Rascunho de e-mail',
  form: 'Formulário',
}

export const WORKFLOW_ENTITY_LABELS: Record<CrmWorkflowEntity, string> = {
  company: 'Empresa',
  person: 'Pessoa',
  opportunity: 'Oportunidade',
  task: 'Tarefa',
  note: 'Nota',
}

export const WORKFLOW_DELAY_UNIT_LABELS: Record<CrmWorkflowDelayUnit, string> =
  {
    seconds: 'Segundos',
    minutes: 'Minutos',
    hours: 'Horas',
    days: 'Dias',
  }

export const WORKFLOW_OPERATOR_LABELS: Record<
  CrmWorkflowFilterOperator,
  string
> = {
  equals: 'é igual a',
  not_equals: 'é diferente de',
  contains: 'contém',
  not_contains: 'não contém',
  is_empty: 'está vazio',
  is_not_empty: 'não está vazio',
  gt: 'maior que',
  gte: 'maior ou igual a',
  lt: 'menor que',
  lte: 'menor ou igual a',
}

export const WORKFLOW_FORM_FIELD_TYPE_LABELS: Record<
  CrmWorkflowFormFieldType,
  string
> = {
  text: 'Texto',
  long_text: 'Texto longo',
  number: 'Número',
  boolean: 'Sim/não',
  select: 'Seleção',
  date: 'Data',
}

export const WORKFLOW_RUN_STATUS_LABELS: Record<CrmWorkflowRunStatus, string> =
  {
    PENDING: 'Na fila',
    RUNNING: 'Em execução',
    WAITING: 'Aguardando',
    COMPLETED: 'Concluída',
    FAILED: 'Falhou',
    CANCELED: 'Cancelada',
  }

export const WORKFLOW_STEP_STATUS_LABELS: Record<
  CrmWorkflowRunStepStatus,
  string
> = {
  PENDING: 'Pendente',
  RUNNING: 'Em execução',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorada',
}

/** Label for a node type that may come from an older definition. */
export function workflowNodeLabel(type: string): string {
  return WORKFLOW_NODE_LABELS[type as CrmWorkflowNodeType] ?? type
}

/** Label for a trigger type as the runs API returns it. */
export function workflowTriggerLabel(type: string): string {
  return WORKFLOW_TRIGGER_LABELS[type as CrmWorkflowTriggerType] ?? type
}

/** Public trigger address of a webhook workflow (`app/api/crm/workflows/[webhookToken]/trigger`). */
export function webhookTriggerPath(token: string): string {
  return `/api/crm/workflows/${token}/trigger`
}
