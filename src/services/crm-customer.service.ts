import { auditMutation } from '@/lib/axiom/audit'
import { ok, type Result } from '@/src/lib/result'
import {
  toCrmCustomerRowDTO,
  toCrmCustomersCsv,
} from '@/src/mappers/crm-customer.mapper'
import { CrmCustomerRepository } from '@/src/repositories/crm-customer.repository'
import {
  CRM_CUSTOMER_EXPORT_LIMIT,
  type CrmCustomerFilters,
  type CrmCustomersPageDTO,
  type ListCrmCustomersQuery,
} from '@/src/schemas/crm-customer.schema'
import { assertModuleMember } from './authz'

/**
 * Clientes: companies and people with a WON opportunity. A read-only view
 * calculated from the deals — the viewer needs `companies` and/or `people`
 * read access for the kinds they ask for.
 */

async function guard(
  actorId: string,
  workspaceId: string,
  kind: CrmCustomerFilters['kind'],
): Promise<Result<true>> {
  if (kind !== 'PERSON') {
    const companies = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!companies.ok) return companies
  }
  if (kind !== 'COMPANY') {
    const people = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'people',
      action: 'VIEW',
    })
    if (!people.ok) return people
  }
  return ok(true as const)
}

export const CrmCustomerService = {
  async list(
    actorId: string,
    workspaceId: string,
    query: ListCrmCustomersQuery,
  ): Promise<Result<CrmCustomersPageDTO>> {
    const access = await guard(actorId, workspaceId, query.kind)
    if (!access.ok) return access

    const { page, pageSize, ...filters } = query
    const [rows, totals] = await Promise.all([
      CrmCustomerRepository.list(
        workspaceId,
        filters,
        (page - 1) * pageSize,
        pageSize,
      ),
      CrmCustomerRepository.totals(workspaceId, filters),
    ])
    if (!rows.ok) return rows
    if (!totals.ok) return totals

    return ok({
      items: rows.value.map(toCrmCustomerRowDTO),
      total: totals.value.customers,
      page,
      pageSize,
      totals: {
        customers: totals.value.customers,
        revenue: totals.value.revenue,
        deals: totals.value.deals,
        averageTicket:
          totals.value.deals > 0
            ? totals.value.revenue / totals.value.deals
            : 0,
      },
    })
  },

  /** The filtered customers as CSV (audited: it exports personal data). */
  async exportCsv(
    actorId: string,
    workspaceId: string,
    filters: CrmCustomerFilters,
  ): Promise<Result<{ csv: string; filename: string }>> {
    const access = await guard(actorId, workspaceId, filters.kind)
    if (!access.ok) return access

    const rows = await CrmCustomerRepository.list(
      workspaceId,
      filters,
      0,
      CRM_CUSTOMER_EXPORT_LIMIT,
    )
    if (!rows.ok) return rows

    auditMutation({
      entity: 'crm_customer',
      action: 'export',
      actorId,
      meta: { workspaceId, rows: rows.value.length, kind: filters.kind },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    return ok({
      csv: toCrmCustomersCsv(rows.value.map(toCrmCustomerRowDTO)),
      filename: `clientes-${stamp}.csv`,
    })
  },

  async filterOptions(actorId: string, workspaceId: string) {
    const access = await guard(actorId, workspaceId, 'ALL')
    if (!access.ok) return access
    return CrmCustomerRepository.filterOptions(workspaceId)
  },
}
