import type {
  CrmDuplicateEntity,
  CrmDuplicateReason,
  CrmDuplicateRecordDTO,
} from '@/types/crm-duplicate'

export const REASON_LABEL: Record<CrmDuplicateReason, string> = {
  email: 'Mesmo e-mail',
  phone: 'Mesmo telefone',
  name: 'Nome parecido',
  cnpj: 'Mesmo CNPJ',
  domain: 'Mesmo domínio',
}

export const ENTITY_LABEL: Record<
  CrmDuplicateEntity,
  { singular: string; plural: string }
> = {
  PERSON: { singular: 'pessoa', plural: 'pessoas' },
  COMPANY: { singular: 'empresa', plural: 'empresas' },
}

/** Record fields shown side by side, in the order a seller scans them. */
export function recordFields(
  entity: CrmDuplicateEntity,
  record: CrmDuplicateRecordDTO,
): Array<{ label: string; value: string }> {
  const rows =
    entity === 'PERSON'
      ? [
          { label: 'E-mails', value: record.emails.join(', ') },
          { label: 'Telefones', value: record.phones.join(', ') },
          { label: 'Empresa', value: record.companyName ?? '' },
          { label: 'Cargo', value: record.jobTitle ?? '' },
          { label: 'Cidade', value: record.city ?? '' },
        ]
      : [
          { label: 'CNPJ', value: record.cnpj ?? '' },
          { label: 'Domínio', value: record.domain ?? '' },
          {
            label: 'Funcionários',
            value: record.employees === null ? '' : String(record.employees),
          },
        ]
  return rows.map((row) => ({ ...row, value: row.value || '—' }))
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatDate = (iso: string) => dateFormat.format(new Date(iso))
export const formatDateTime = (iso: string) =>
  dateTimeFormat.format(new Date(iso))
