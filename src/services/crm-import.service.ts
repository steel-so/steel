import { auditMutation } from '@/lib/axiom/audit'
import type { AppError } from '@/src/errors/app-error'
import { ok, type Result } from '@/src/lib/result'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { CreateCrmCompanySchema } from '@/src/schemas/crm-company.schema'
import type {
  CrmImportDTO,
  CrmImportEntity,
  CrmImportResultDTO,
  CrmImportRow,
} from '@/src/schemas/crm-import.schema'
import { CreateCrmLeadSchema } from '@/src/schemas/crm-lead.schema'
import { CreateCrmPersonSchema } from '@/src/schemas/crm-person.schema'
import { assertModuleMember } from './authz'
import { CrmCompanyService } from './crm-company.service'
import { CrmLeadService } from './crm-lead.service'
import { CrmPersonService } from './crm-person.service'

const DEFAULT_LEAD_SOURCE = 'Importação CSV'

const RESOURCE = {
  leads: 'leads',
  people: 'people',
  companies: 'companies',
} as const

const AUDIT_ENTITY = {
  leads: 'crm_lead',
  people: 'crm_person',
  companies: 'crm_company',
} as const

type Rejected = CrmImportResultDTO['rejected'][number]

/** Outcome of one row: created, or the plain-language reason it was not. */
type RowOutcome = { created: true } | { created: false; reason: string }

const rejectedRow = (reason: string): RowOutcome => ({
  created: false,
  reason,
})

const splitList = (value: string | undefined, separator: RegExp): string[] =>
  (value ?? '')
    .split(separator)
    .map((v) => v.trim())
    .filter(Boolean)

const emailsOf = (value: string | undefined): string[] => [
  ...new Set(splitList(value, /[\s;,|]+/).map((v) => v.toLowerCase())),
]

const phonesOf = (value: string | undefined): string[] =>
  splitList(value, /[;|,\n]+/)

const digits = (value: string): string => value.replace(/\D/g, '')

/** `https://www.Acme.com.br/contato` → `acme.com.br`. */
function normalizeDomain(value: string | undefined): string | undefined {
  const domain = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/, 1)[0]
  return domain || undefined
}

const FIELD_LABEL: Record<string, string> = {
  cnpj: 'CNPJ',
  domain: 'Site',
  employees: 'Funcionários',
  linkedin: 'LinkedIn',
  city: 'Cidade',
  jobTitle: 'Cargo',
  company: 'Empresa',
  source: 'Origem',
  channel: 'Canal',
}

/** First zod issue as a sentence the user can act on. */
function issueReason(
  issues: { message: string; path: PropertyKey[] }[],
): string {
  const [issue] = issues
  if (!issue) return 'Linha inválida'
  const field = String(issue.path[0] ?? '')
  // `emails` with an index is an invalid address; without, the refine message.
  if (field === 'emails' && issue.path.length > 1) return 'E-mail inválido'
  if (field === 'phones') return 'Telefone inválido'
  if (field === 'name' || field === 'emails') return issue.message
  return `${FIELD_LABEL[field] ?? 'Linha'}: valor inválido ou longo demais`
}

/** Row key used to catch repeated lines inside the file. */
function fileKeys(entity: CrmImportEntity, row: CrmImportRow): string[] {
  if (entity === 'companies') {
    return [
      ...(row.cnpj && digits(row.cnpj) ? [`cnpj:${digits(row.cnpj)}`] : []),
      ...(normalizeDomain(row.domain)
        ? [`domain:${normalizeDomain(row.domain)}`]
        : []),
    ]
  }
  return [
    ...emailsOf(row.email).map((e) => `e:${e}`),
    ...phonesOf(row.phone)
      .map((p) => digits(p))
      .filter(Boolean)
      .map((p) => `p:${p.length <= 11 ? `55${p}` : p}`),
  ]
}

const reasonOf = (error: AppError): string =>
  error.code === 'DATABASE_ERROR'
    ? 'Erro ao salvar esta linha. Tente de novo.'
    : error.message

async function importLead(
  actorId: string,
  workspaceId: string,
  row: CrmImportRow,
): Promise<RowOutcome> {
  const parsed = CreateCrmLeadSchema.safeParse({
    name: row.name ?? '',
    emails: emailsOf(row.email),
    phones: phonesOf(row.phone),
    company: row.company,
    jobTitle: row.jobTitle,
    city: row.city,
    linkedin: row.linkedin,
    source: row.source || DEFAULT_LEAD_SOURCE,
    channel: row.channel,
  })
  if (!parsed.success) return rejectedRow(issueReason(parsed.error.issues))

  const result = await CrmLeadService.intake(
    workspaceId,
    { kind: 'user', userId: actorId },
    parsed.data,
    { quiet: true },
  )
  if (!result.ok) return rejectedRow(reasonOf(result.error))
  if (!result.value.created) {
    return rejectedRow(
      'Já existe um lead em aberto com este e-mail ou telefone',
    )
  }
  return { created: true }
}

async function importPerson(
  actorId: string,
  workspaceId: string,
  row: CrmImportRow,
  companiesByName: Map<string, string>,
): Promise<RowOutcome> {
  const parsed = CreateCrmPersonSchema.safeParse({
    name: row.name ?? '',
    emails: emailsOf(row.email),
    phones: phonesOf(row.phone),
    city: row.city,
    jobTitle: row.jobTitle,
    linkedin: row.linkedin,
    companyId: row.company
      ? companiesByName.get(row.company.toLowerCase())
      : undefined,
  })
  if (!parsed.success) return rejectedRow(issueReason(parsed.error.issues))
  if (parsed.data.emails.length === 0 && parsed.data.phones.length === 0) {
    return rejectedRow('Informe ao menos um e-mail ou telefone')
  }

  const existing = await CrmPersonRepository.findFirstByContacts(workspaceId, {
    emails: parsed.data.emails,
    phones: parsed.data.phones.map(digits),
  })
  if (!existing.ok) return rejectedRow(reasonOf(existing.error))
  if (existing.value) {
    return rejectedRow('Já existe uma pessoa com este e-mail ou telefone')
  }

  const result = await CrmPersonService.create(
    actorId,
    workspaceId,
    parsed.data,
  )
  if (!result.ok) return rejectedRow(reasonOf(result.error))
  return { created: true }
}

async function importCompany(
  actorId: string,
  workspaceId: string,
  row: CrmImportRow,
): Promise<RowOutcome> {
  const employees = row.employees ? Number(digits(row.employees)) : undefined
  if (row.employees && !digits(row.employees)) {
    return rejectedRow('Funcionários: informe só o número')
  }
  const parsed = CreateCrmCompanySchema.safeParse({
    name: row.name ?? '',
    cnpj: row.cnpj,
    domain: normalizeDomain(row.domain),
    employees,
    linkedin: row.linkedin,
    address:
      row.city || row.state
        ? { city: row.city, state: row.state?.toUpperCase() }
        : undefined,
  })
  if (!parsed.success) return rejectedRow(issueReason(parsed.error.issues))

  const result = await CrmCompanyService.create(
    actorId,
    workspaceId,
    parsed.data,
  )
  if (!result.ok) return rejectedRow(reasonOf(result.error))
  return { created: true }
}

/**
 * CSV import of leads, people and companies. The browser parses the file and
 * posts the rows; each row then goes through the same create flow as the
 * manual form (validation, dedupe, scoring/routing for leads, audit,
 * workflows, search index), so a bad or repeated row is rejected with a
 * reason and never blocks the others. Leads are created in quiet bulk mode
 * (no per-lead Slack/webhook/owner notification).
 */
export const CrmImportService = {
  async import(
    actorId: string,
    workspaceId: string,
    dto: CrmImportDTO,
  ): Promise<Result<CrmImportResultDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE[dto.entity],
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    let companiesByName = new Map<string, string>()
    if (dto.entity === 'people') {
      const companies = await CrmCompanyRepository.listByWorkspace(workspaceId)
      if (!companies.ok) return companies
      companiesByName = new Map(
        companies.value.map((c) => [c.name.trim().toLowerCase(), c.id]),
      )
    }

    const rejected: Rejected[] = []
    const seen = new Set<string>()
    let created = 0

    for (const [index, row] of dto.rows.entries()) {
      const number = index + 1
      const name = row.name ?? ''
      const keys = fileKeys(dto.entity, row)
      if (keys.some((k) => seen.has(k))) {
        rejected.push({ row: number, name, reason: 'Repetido no arquivo' })
        continue
      }

      let outcome: RowOutcome
      if (dto.entity === 'leads') {
        outcome = await importLead(actorId, workspaceId, row)
      } else if (dto.entity === 'people') {
        outcome = await importPerson(actorId, workspaceId, row, companiesByName)
      } else {
        outcome = await importCompany(actorId, workspaceId, row)
      }

      if (outcome.created) {
        created++
        for (const key of keys) seen.add(key)
      } else {
        rejected.push({ row: number, name, reason: outcome.reason })
      }
    }

    auditMutation({
      entity: AUDIT_ENTITY[dto.entity],
      action: 'import',
      actorId,
      targetId: workspaceId,
      meta: {
        workspaceId,
        rows: dto.rows.length,
        consentConfirmed: true,
        created,
        rejected: rejected.length,
      },
    })

    return ok({ created, rejected })
  },
}
