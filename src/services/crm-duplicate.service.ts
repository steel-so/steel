import type { CrmDuplicateEntity } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { crmDuplicateInvalid, crmDuplicateNotFound } from '@/src/errors'
import {
  type DuplicatePair,
  findCompanyDuplicates,
  findCompanyMatches,
  findPersonDuplicates,
  findPersonMatches,
} from '@/src/lib/crm-duplicates/detect'
import {
  type CompanyFields,
  type PersonFields,
  planCompanyMerge,
  planPersonMerge,
} from '@/src/lib/crm-duplicates/merge-plan'
import { err, ok, type Result } from '@/src/lib/result'
import {
  companyToDuplicateRecord,
  personToDuplicateRecord,
  toCrmDuplicateDTO,
  toCrmMergeDTO,
} from '@/src/mappers/crm-duplicate.mapper'
import { CrmDuplicateRepository } from '@/src/repositories/crm-duplicate.repository'
import { NotificationAudienceRepository } from '@/src/repositories/notification-audience.repository'
import type {
  ListCrmDuplicatesDTO,
  MergeCrmDuplicateDTO,
} from '@/src/schemas/crm-duplicate.schema'
import type {
  CrmDuplicateDTO,
  CrmDuplicatePageDTO,
  CrmDuplicateScanDTO,
  CrmMergeDTO,
} from '@/types/crm-duplicate'
import { assertModuleMember } from './authz'
import { emitNotification } from './notification-emitter'

/** How long a merge can be undone. */
export const MERGE_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

const RESOURCE: Record<CrmDuplicateEntity, 'people' | 'companies'> = {
  PERSON: 'people',
  COMPANY: 'companies',
}

const ENTITIES: CrmDuplicateEntity[] = ['PERSON', 'COMPANY']

export const CRM_DUPLICATES_PATH = '/crm/duplicates'

/** The window the periodic scan covers per run, to bound one job. */
const NOTIFY_ADMINS = 10

export interface ScheduledScanResult {
  workspaces: number
  created: number
  failed: number
}

function personFields(row: {
  name: string
  emails: string[]
  phones: string[]
  city: string | null
  jobTitle: string | null
  linkedin: string | null
  avatar: string | null
  companyId: string | null
}): PersonFields {
  return {
    name: row.name,
    emails: row.emails,
    phones: row.phones,
    city: row.city,
    jobTitle: row.jobTitle,
    linkedin: row.linkedin,
    avatar: row.avatar,
    companyId: row.companyId,
  }
}

function companyFields(row: {
  name: string
  cnpj: string | null
  domain: string | null
  employees: number | null
  linkedin: string | null
  address: unknown
  arr: { toString(): string } | null
  icp: boolean
  accountOwnerId: string | null
}): CompanyFields {
  return {
    name: row.name,
    cnpj: row.cnpj,
    domain: row.domain,
    employees: row.employees,
    linkedin: row.linkedin,
    address: row.address,
    arr: row.arr === null ? null : row.arr.toString(),
    icp: row.icp,
    accountOwnerId: row.accountOwnerId,
  }
}

async function scanEntity(
  workspaceId: string,
  entity: CrmDuplicateEntity,
): Promise<Result<{ pairs: DuplicatePair[]; created: DuplicatePair[] }>> {
  let pairs: DuplicatePair[]
  if (entity === 'PERSON') {
    const people = await CrmDuplicateRepository.loadPeople(workspaceId)
    if (!people.ok) return people
    pairs = findPersonDuplicates(people.value)
  } else {
    const companies = await CrmDuplicateRepository.loadCompanies(workspaceId)
    if (!companies.ok) return companies
    pairs = findCompanyDuplicates(companies.value)
  }
  const saved = await CrmDuplicateRepository.saveScan(
    workspaceId,
    entity,
    pairs,
    {
      prune: true,
    },
  )
  if (!saved.ok) return saved
  return ok({ pairs, created: saved.value.created })
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export const CrmDuplicateService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListCrmDuplicatesDTO,
  ): Promise<Result<CrmDuplicatePageDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE[filters.entity],
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const page = await CrmDuplicateRepository.list(workspaceId, {
      entity: filters.entity,
      status: filters.status,
      take: filters.pageSize,
      skip: (filters.page - 1) * filters.pageSize,
    })
    if (!page.ok) return page
    const counts = await CrmDuplicateRepository.pendingCounts(workspaceId)
    if (!counts.ok) return counts

    const ids = [
      ...new Set(page.value.rows.flatMap((row) => [row.leftId, row.rightId])),
    ]
    const footprint = await CrmDuplicateRepository.footprint(
      filters.entity,
      ids,
    )
    if (!footprint.ok) return footprint
    const history = (id: string) => footprint.value.get(id) ?? 0

    const records = new Map<
      string,
      ReturnType<typeof companyToDuplicateRecord>
    >()
    if (filters.entity === 'PERSON') {
      const people = await CrmDuplicateRepository.peopleByIds(workspaceId, ids)
      if (!people.ok) return people
      for (const person of people.value) {
        records.set(
          person.id,
          personToDuplicateRecord(person, history(person.id)),
        )
      }
    } else {
      const companies = await CrmDuplicateRepository.companiesByIds(
        workspaceId,
        ids,
      )
      if (!companies.ok) return companies
      for (const company of companies.value) {
        records.set(
          company.id,
          companyToDuplicateRecord(company, history(company.id)),
        )
      }
    }

    const items: CrmDuplicateDTO[] = []
    for (const row of page.value.rows) {
      const left = records.get(row.leftId)
      const right = records.get(row.rightId)
      // A side that no longer exists makes the pair stale; the next scan prunes it.
      if (!left || !right) continue
      items.push(toCrmDuplicateDTO(row, left, right))
    }
    return ok({
      items,
      total: page.value.total,
      page: filters.page,
      pageSize: filters.pageSize,
      pending: counts.value,
    })
  },

  /** Manual scan of the workspace (the "Procurar duplicados" button). */
  async scan(
    actorId: string,
    workspaceId: string,
    entity?: CrmDuplicateEntity,
  ): Promise<Result<CrmDuplicateScanDTO>> {
    const targets = entity ? [entity] : ENTITIES
    for (const target of targets) {
      const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
        resource: RESOURCE[target],
        action: 'EDIT',
      })
      if (!membership.ok) return membership
    }
    const out: CrmDuplicateScanDTO = {
      person: { pairs: 0, created: 0 },
      company: { pairs: 0, created: 0 },
    }
    for (const target of targets) {
      const result = await scanEntity(workspaceId, target)
      if (!result.ok) return result
      const key = target === 'PERSON' ? 'person' : 'company'
      out[key] = {
        pairs: result.value.pairs.length,
        created: result.value.created.length,
      }
    }
    auditMutation({
      entity: 'crm_duplicate',
      action: 'sync',
      actorId,
      meta: { workspaceId, ...out },
    })
    return ok(out)
  },

  async dismiss(
    actorId: string,
    workspaceId: string,
    candidateId: string,
  ): Promise<Result<CrmDuplicateDTO['status']>> {
    const found = await CrmDuplicateRepository.findCandidate(
      workspaceId,
      candidateId,
    )
    if (!found.ok) return found
    if (!found.value) return err(crmDuplicateNotFound())
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE[found.value.entity],
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    if (found.value.status !== 'PENDING') {
      return err(crmDuplicateInvalid('Esse par já foi resolvido'))
    }
    const result = await CrmDuplicateRepository.dismiss(candidateId, actorId)
    if (!result.ok) return result
    auditMutation({
      entity: 'crm_duplicate',
      action: 'resolve',
      actorId,
      targetId: candidateId,
      meta: { workspaceId, outcome: 'dismissed' },
    })
    return ok(result.value.status)
  },

  async merge(
    actorId: string,
    workspaceId: string,
    candidateId: string,
    dto: MergeCrmDuplicateDTO,
  ): Promise<Result<CrmMergeDTO>> {
    const found = await CrmDuplicateRepository.findCandidate(
      workspaceId,
      candidateId,
    )
    if (!found.ok) return found
    const candidate = found.value
    if (!candidate) return err(crmDuplicateNotFound())
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE[candidate.entity],
      action: 'DELETE',
    })
    if (!membership.ok) return membership
    if (candidate.status !== 'PENDING') {
      return err(crmDuplicateInvalid('Esse par já foi resolvido'))
    }
    if (
      dto.survivorId !== candidate.leftId &&
      dto.survivorId !== candidate.rightId
    ) {
      return err(
        crmDuplicateInvalid(
          'O registro mantido precisa ser um dos dois do par',
        ),
      )
    }
    const mergedId =
      dto.survivorId === candidate.leftId ? candidate.rightId : candidate.leftId

    const pair = await CrmDuplicateRepository.loadPair(
      workspaceId,
      candidate.entity,
      dto.survivorId,
      mergedId,
    )
    if (!pair.ok) return pair
    if (!pair.value.survivor || !pair.value.merged) {
      return err(crmDuplicateInvalid('Um dos registros não existe mais'))
    }

    const survivor = pair.value.survivor
    const merged = pair.value.merged
    const plan =
      candidate.entity === 'PERSON'
        ? planPersonMerge(
            personFields(survivor as Parameters<typeof personFields>[0]),
            personFields(merged as Parameters<typeof personFields>[0]),
          )
        : planCompanyMerge(
            companyFields(survivor as Parameters<typeof companyFields>[0]),
            companyFields(merged as Parameters<typeof companyFields>[0]),
          )

    const result = await CrmDuplicateRepository.executeMerge({
      workspaceId,
      entity: candidate.entity,
      survivorId: dto.survivorId,
      mergedId,
      candidateId,
      performedById: actorId,
      plan,
      undoUntil: new Date(Date.now() + MERGE_UNDO_WINDOW_MS),
      summary: `Mesclou "${merged.name}" em "${survivor.name}"`,
      names: { survivor: survivor.name, merged: merged.name },
    })
    if (!result.ok) {
      auditMutation({
        entity: 'crm_merge',
        action: 'merge',
        actorId,
        targetId: dto.survivorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }
    auditMutation({
      entity: 'crm_merge',
      action: 'merge',
      actorId,
      targetId: dto.survivorId,
      meta: {
        workspaceId,
        entity: candidate.entity,
        mergedId,
        mergeId: result.value.id,
        fieldsChanged: Object.keys(plan.after),
      },
    })
    return ok(toCrmMergeDTO(result.value))
  },

  async undo(
    actorId: string,
    workspaceId: string,
    mergeId: string,
  ): Promise<Result<CrmMergeDTO>> {
    const found = await CrmDuplicateRepository.findMerge(workspaceId, mergeId)
    if (!found.ok) return found
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE[found.value.entity],
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const name = toCrmMergeDTO(found.value).mergedName
    const result = await CrmDuplicateRepository.undoMerge({
      workspaceId,
      mergeId,
      undoneById: actorId,
      summary: name ? `Desfez a mesclagem de "${name}"` : 'Desfez a mesclagem',
    })
    if (!result.ok) {
      auditMutation({
        entity: 'crm_merge',
        action: 'undo',
        actorId,
        targetId: mergeId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }
    auditMutation({
      entity: 'crm_merge',
      action: 'undo',
      actorId,
      targetId: mergeId,
      meta: {
        workspaceId,
        survivorId: result.value.survivorId,
        mergedId: result.value.mergedId,
      },
    })
    return ok(toCrmMergeDTO(result.value))
  },

  async listMerges(
    actorId: string,
    workspaceId: string,
    entity: CrmDuplicateEntity,
  ): Promise<Result<CrmMergeDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE[entity],
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const rows = await CrmDuplicateRepository.listMerges(
      workspaceId,
      entity,
      20,
    )
    if (!rows.ok) return rows
    const now = new Date()
    return ok(rows.value.map((row) => toCrmMergeDTO(row, now)))
  },

  /**
   * Arrival check (imports, forms, zap, manual create): compares one new
   * record with its neighbourhood and stores the pairs. Fire-and-forget:
   * failures are logged and never block the write that triggered it.
   */
  async flagOnArrival(
    workspaceId: string,
    entity: CrmDuplicateEntity,
    recordId: string,
  ): Promise<number> {
    try {
      let pairs: DuplicatePair[] = []
      if (entity === 'PERSON') {
        const hood = await CrmDuplicateRepository.personNeighbourhood(
          workspaceId,
          recordId,
        )
        if (!hood.ok || !hood.value) return 0
        pairs = findPersonMatches(hood.value.probe, hood.value.others)
      } else {
        const hood = await CrmDuplicateRepository.companyNeighbourhood(
          workspaceId,
          recordId,
        )
        if (!hood.ok || !hood.value) return 0
        pairs = findCompanyMatches(hood.value.probe, hood.value.others)
      }
      if (pairs.length === 0) return 0
      const saved = await CrmDuplicateRepository.saveScan(
        workspaceId,
        entity,
        pairs,
        {
          prune: false,
        },
      )
      return saved.ok ? saved.value.created.length : 0
    } catch (error) {
      logger.warn('crm.duplicates.arrival_failed', {
        workspaceId,
        entity,
        error: error instanceof Error ? error.message : String(error),
      })
      return 0
    }
  },

  /** Full scan of one workspace; tells the admins once about new pairs. */
  async detectWorkspace(workspaceId: string): Promise<Result<number>> {
    let created = 0
    for (const entity of ENTITIES) {
      const result = await scanEntity(workspaceId, entity)
      if (!result.ok) return result
      created += result.value.created.length
      const counts = await CrmDuplicateRepository.pendingCounts(workspaceId)
      if (counts.ok) {
        const pending =
          entity === 'PERSON' ? counts.value.person : counts.value.company
        if (pending > 0) await notifyPending(workspaceId, entity, pending)
      }
    }
    return ok(created)
  },

  /** The worker's daily job: every workspace with the CRM module on. */
  async runScheduled(): Promise<Result<ScheduledScanResult>> {
    const workspaces = await CrmDuplicateRepository.listCrmWorkspaceIds()
    if (!workspaces.ok) return workspaces
    const out: ScheduledScanResult = { workspaces: 0, created: 0, failed: 0 }
    for (const workspaceId of workspaces.value) {
      out.workspaces += 1
      const result = await CrmDuplicateService.detectWorkspace(workspaceId)
      if (!result.ok) {
        out.failed += 1
        logger.error('crm.duplicates.scan_failed', {
          workspaceId,
          code: result.error.code,
        })
        continue
      }
      out.created += result.value
    }
    return ok(out)
  },
}

async function notifyPending(
  workspaceId: string,
  entity: CrmDuplicateEntity,
  pending: number,
): Promise<void> {
  const marked = await CrmDuplicateRepository.markNotified(workspaceId, entity)
  if (!marked.ok || marked.value === 0) return
  const admins = await NotificationAudienceRepository.listPrivilegedUserIds(
    workspaceId,
    NOTIFY_ADMINS,
  )
  if (!admins.ok) return
  const noun =
    entity === 'PERSON'
      ? plural(pending, 'par de pessoas', 'pares de pessoas')
      : plural(pending, 'par de empresas', 'pares de empresas')
  await emitNotification({
    workspaceId,
    recipients: admins.value,
    kind: 'CRM_DUPLICATES_FOUND',
    title: 'Possíveis duplicados no CRM',
    body: `${noun} para revisar. Mescle ou descarte na fila de duplicados.`,
    path: `${CRM_DUPLICATES_PATH}?entity=${entity}`,
    dedupeKey: `crm-duplicates:${workspaceId}:${entity}:${new Date().toISOString().slice(0, 10)}`,
  })
}
