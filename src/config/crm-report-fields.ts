import type { CrmReportSource } from '@/src/schemas/crm-report.schema'

/**
 * Catálogo de campos das fontes de relatório (rótulos, tipos e relacionamentos).
 * Compartilhado entre o runner (`crm-report-runner.ts`) e a UI do builder.
 */

export type CrmReportFieldType = 'text' | 'number' | 'date'

export type CrmReportFieldDef = {
  key: string
  label: string
  type: CrmReportFieldType
}

/** Campos selecionáveis por fonte (rótulo + chave do DTO + tipo). */
export const CRM_REPORT_FIELDS: Record<CrmReportSource, CrmReportFieldDef[]> = {
  company: [
    { key: 'name', label: 'Nome', type: 'text' },
    { key: 'domain', label: 'Domínio', type: 'text' },
    { key: 'cnpj', label: 'CNPJ', type: 'text' },
    { key: 'employees', label: 'Funcionários', type: 'number' },
    { key: 'arr', label: 'RRA', type: 'number' },
    { key: 'icp', label: 'PCI', type: 'text' },
    { key: 'createdAt', label: 'Criado em', type: 'date' },
  ],
  person: [
    { key: 'name', label: 'Nome', type: 'text' },
    { key: 'emails', label: 'E-mails', type: 'text' },
    { key: 'phones', label: 'Telefones', type: 'text' },
    { key: 'city', label: 'Cidade', type: 'text' },
    { key: 'jobTitle', label: 'Cargo', type: 'text' },
    { key: 'createdAt', label: 'Criado em', type: 'date' },
  ],
  opportunity: [
    { key: 'name', label: 'Nome', type: 'text' },
    { key: 'amount', label: 'Valor', type: 'number' },
    { key: 'closeDate', label: 'Fechamento', type: 'date' },
    { key: 'source', label: 'Origem', type: 'text' },
    { key: 'createdAt', label: 'Criado em', type: 'date' },
  ],
  lead: [
    { key: 'name', label: 'Nome', type: 'text' },
    { key: 'emails', label: 'E-mails', type: 'text' },
    { key: 'company', label: 'Empresa', type: 'text' },
    { key: 'source', label: 'Origem', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'score', label: 'Score', type: 'number' },
    { key: 'createdAt', label: 'Criado em', type: 'date' },
  ],
  task: [
    { key: 'title', label: 'Título', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'dueDate', label: 'Vencimento', type: 'date' },
    { key: 'createdAt', label: 'Criado em', type: 'date' },
  ],
  note: [
    { key: 'title', label: 'Título', type: 'text' },
    { key: 'createdAt', label: 'Criado em', type: 'date' },
  ],
  product: [
    { key: 'name', label: 'Nome', type: 'text' },
    { key: 'sku', label: 'SKU', type: 'text' },
    { key: 'unitPrice', label: 'Preço', type: 'number' },
    { key: 'billingType', label: 'Cobrança', type: 'text' },
    { key: 'active', label: 'Ativo', type: 'text' },
  ],
  whatsapp_conversation: [
    { key: 'contactName', label: 'Contato', type: 'text' },
    { key: 'contactWaId', label: 'Telefone', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'assignedUserName', label: 'Atendente', type: 'text' },
    { key: 'assignedUserId', label: 'ID do atendente', type: 'text' },
    { key: 'aiActive', label: 'IA ativa', type: 'text' },
    { key: 'aiHandoff', label: 'Transferida p/ humano', type: 'text' },
    { key: 'unreadCount', label: 'Não lidas', type: 'number' },
    { key: 'avgSentimentScore', label: 'Sentimento médio', type: 'number' },
    { key: 'lastMessageAt', label: 'Última mensagem', type: 'date' },
    { key: 'createdAt', label: 'Criado em', type: 'date' },
  ],
  whatsapp_broadcast: [
    { key: 'name', label: 'Nome', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'recipientCount', label: 'Destinatários', type: 'number' },
    { key: 'sentCount', label: 'Enviados', type: 'number' },
    { key: 'failedCount', label: 'Falhas', type: 'number' },
    { key: 'scheduledAt', label: 'Agendado para', type: 'date' },
    { key: 'createdAt', label: 'Criado em', type: 'date' },
  ],
}

export const CRM_REPORT_SOURCE_LABELS: Record<CrmReportSource, string> = {
  company: 'Empresas',
  person: 'Pessoas',
  opportunity: 'Oportunidades',
  lead: 'Leads',
  task: 'Tarefas',
  note: 'Anotações',
  product: 'Produtos',
  whatsapp_conversation: 'Conversas do WhatsApp',
  whatsapp_broadcast: 'Transmissões do WhatsApp',
}

/**
 * Relacionamentos joináveis por fonte: a chave estrangeira (`field`) aponta
 * para o `id` da fonte `to`. Alimenta a configuração de mesclagem (JOIN).
 */
export type CrmReportRelation = {
  field: string
  to: CrmReportSource
  toField: string
  label: string
}

export const CRM_REPORT_RELATIONS: Record<
  CrmReportSource,
  CrmReportRelation[]
> = {
  company: [],
  person: [
    { field: 'companyId', to: 'company', toField: 'id', label: 'Empresa' },
  ],
  opportunity: [
    { field: 'companyId', to: 'company', toField: 'id', label: 'Empresa' },
    {
      field: 'pointOfContactId',
      to: 'person',
      toField: 'id',
      label: 'Contato',
    },
  ],
  lead: [],
  task: [
    { field: 'companyId', to: 'company', toField: 'id', label: 'Empresa' },
    { field: 'personId', to: 'person', toField: 'id', label: 'Pessoa' },
    {
      field: 'opportunityId',
      to: 'opportunity',
      toField: 'id',
      label: 'Oportunidade',
    },
  ],
  note: [
    { field: 'companyId', to: 'company', toField: 'id', label: 'Empresa' },
    { field: 'personId', to: 'person', toField: 'id', label: 'Pessoa' },
    {
      field: 'opportunityId',
      to: 'opportunity',
      toField: 'id',
      label: 'Oportunidade',
    },
  ],
  product: [],
  whatsapp_conversation: [],
  whatsapp_broadcast: [],
}

/** Rótulo amigável de um campo (com fallback para a própria chave). */
export function crmReportFieldLabel(
  source: CrmReportSource,
  key: string,
): string {
  return CRM_REPORT_FIELDS[source].find((f) => f.key === key)?.label ?? key
}

/** Tipo de um campo (default "text" quando não catalogado). */
export function crmReportFieldType(
  source: CrmReportSource,
  key: string,
): CrmReportFieldType {
  return CRM_REPORT_FIELDS[source].find((f) => f.key === key)?.type ?? 'text'
}
