import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeCnpjProfile,
  createFakeCnpjRun,
  createFakeCompanyEnrichment,
  VALID_CNPJ,
} from '@/src/__tests__/factories/nov-c2-cnpj-enrichment.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmCnpjLookupFailed,
  crmCnpjNotFound,
  databaseError,
  notFound,
} from '@/src/errors'
import { crmCnpjRunNotCancelable } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-company-enrichment.repository')
vi.mock('@/src/repositories/crm-cnpj-run.repository')
vi.mock('@/src/lib/cnpj/provider', () => ({
  getCnpjProvider: vi.fn(),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getCrmCnpjEnrichmentQueue: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { getCnpjProvider } from '@/src/lib/cnpj/provider'
import { getCrmCnpjEnrichmentQueue } from '@/src/lib/queue/queues'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { CrmCnpjRunRepository } from '@/src/repositories/crm-cnpj-run.repository'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmCompanyEnrichmentRepository } from '@/src/repositories/crm-company-enrichment.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  CrmCnpjEnrichmentService,
  enrichCompany,
} from '../crm-cnpj-enrichment.service'

const members = vi.mocked(MembershipRepository)
const companies = vi.mocked(CrmCompanyRepository)
const enrichments = vi.mocked(CrmCompanyEnrichmentRepository)
const runs = vi.mocked(CrmCnpjRunRepository)
const lookupMock = vi.fn()
const addJob = vi.fn()

const WS = 'ws1'
const ACTOR = 'u1'

function asRole(role: Role) {
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const company = (over: Parameters<typeof createFakeCrmCompany>[0] = {}) =>
  createFakeCrmCompany({
    id: 'c1',
    workspaceId: WS,
    cnpj: VALID_CNPJ,
    name: 'Empresa 11.222.333/0001-81',
    ...over,
  })

beforeEach(() => {
  vi.clearAllMocks()
  asRole('OWNER')
  vi.mocked(getCnpjProvider).mockReturnValue({
    source: 'brasilapi',
    lookup: lookupMock,
  })
  lookupMock.mockResolvedValue(ok(createFakeCnpjProfile()))
  enrichments.upsert.mockImplementation(async (companyId, workspaceId) =>
    ok(createFakeCompanyEnrichment({ companyId, workspaceId })),
  )
  companies.update.mockImplementation(async (id, data) =>
    ok(
      company({
        id,
        name: (data.name as string | undefined) ?? 'Empresa 11.222.333/0001-81',
        address: (data.address as never) ?? null,
      }),
    ),
  )
  vi.mocked(getCrmCnpjEnrichmentQueue).mockReturnValue({
    add: addJob,
  } as never)
  addJob.mockResolvedValue({})
})

describe('CrmCnpjEnrichmentService', () => {
  describe('authorization', () => {
    it.each([
      [
        'lookup',
        () => CrmCnpjEnrichmentService.lookup(ACTOR, WS, { cnpj: VALID_CNPJ }),
      ],
      [
        'getForCompany',
        () => CrmCnpjEnrichmentService.getForCompany(ACTOR, WS, 'c1'),
      ],
      [
        'listRuns',
        () => CrmCnpjEnrichmentService.listRuns(ACTOR, WS, { limit: 5 }),
      ],
      ['getRun', () => CrmCnpjEnrichmentService.getRun(ACTOR, WS, 'r1')],
      ['cancelRun', () => CrmCnpjEnrichmentService.cancelRun(ACTOR, WS, 'r1')],
      [
        'enrich',
        () =>
          CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
            overwrite: false,
          }),
      ],
      [
        'startRun',
        () =>
          CrmCnpjEnrichmentService.startRun(ACTOR, WS, {
            onlyMissing: true,
            overwrite: false,
          }),
      ],
    ])('forbids a non-member on %s', async (_name, call) => {
      members.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await call(), 'FORBIDDEN')
    })

    it('forbids a VIEWER from enriching', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
        'FORBIDDEN',
      )
      expect(lookupMock).not.toHaveBeenCalled()
    })

    it('lets a VIEWER read but not start a run', async () => {
      asRole('VIEWER')
      runs.listByWorkspace.mockResolvedValue(ok([]))
      expectOk(await CrmCnpjEnrichmentService.listRuns(ACTOR, WS, { limit: 5 }))
      expectErr(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, {
          onlyMissing: true,
          overwrite: false,
        }),
        'FORBIDDEN',
      )
    })

    it('forbids a MEMBER from canceling a bulk run (OWNER/ADMIN only)', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmCnpjEnrichmentService.cancelRun(ACTOR, WS, 'r1'),
        'FORBIDDEN',
      )
      expect(runs.requestCancel).not.toHaveBeenCalled()
    })

    it('forbids a MEMBER from starting a bulk run (OWNER/ADMIN only)', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, {
          onlyMissing: true,
          overwrite: false,
        }),
        'FORBIDDEN',
      )
    })

    it('blocks when the CRM module is disabled', async () => {
      vi.mocked(
        WorkspaceModuleAccessRepository.isEnabled,
      ).mockResolvedValueOnce(ok(false))
      expectErr(
        await CrmCnpjEnrichmentService.lookup(ACTOR, WS, { cnpj: VALID_CNPJ }),
        'MODULE_DISABLED',
      )
    })
  })

  describe('lookup', () => {
    it('returns the registry preview', async () => {
      const dto = expectOk(
        await CrmCnpjEnrichmentService.lookup(ACTOR, WS, {
          cnpj: '11.222.333/0001-81',
        }),
      )
      expect(dto.legalName).toBe('ACME COMERCIO DE ALIMENTOS LTDA')
      expect(lookupMock).toHaveBeenCalledWith(VALID_CNPJ)
    })

    it('rejects a CNPJ with bad check digits', async () => {
      expectErr(
        await CrmCnpjEnrichmentService.lookup(ACTOR, WS, {
          cnpj: '11222333000182',
        }),
        'CRM_CNPJ_INVALID',
      )
      expect(lookupMock).not.toHaveBeenCalled()
    })

    it('propagates provider errors', async () => {
      lookupMock.mockResolvedValue(err(crmCnpjNotFound()))
      expectErr(
        await CrmCnpjEnrichmentService.lookup(ACTOR, WS, { cnpj: VALID_CNPJ }),
        'CRM_CNPJ_NOT_FOUND',
      )
    })
  })

  describe('getForCompany', () => {
    it('returns the stored profile', async () => {
      companies.findById.mockResolvedValue(ok(company()))
      enrichments.findByCompany.mockResolvedValue(
        ok(createFakeCompanyEnrichment({ companyId: 'c1' })),
      )
      const dto = expectOk(
        await CrmCnpjEnrichmentService.getForCompany(ACTOR, WS, 'c1'),
      )
      expect(dto?.companyId).toBe('c1')
    })

    it('returns null when never enriched', async () => {
      companies.findById.mockResolvedValue(ok(company()))
      enrichments.findByCompany.mockResolvedValue(ok(null))
      expect(
        expectOk(await CrmCnpjEnrichmentService.getForCompany(ACTOR, WS, 'c1')),
      ).toBeNull()
    })

    it('does not reach a company of another workspace', async () => {
      companies.findById.mockResolvedValue(err(notFound('CrmCompany')))
      expectErr(
        await CrmCnpjEnrichmentService.getForCompany(ACTOR, WS, 'other'),
        'RESOURCE_NOT_FOUND',
      )
      expect(companies.findById).toHaveBeenCalledWith('other', WS)
    })

    it('propagates database errors', async () => {
      companies.findById.mockResolvedValue(ok(company()))
      enrichments.findByCompany.mockResolvedValue(err(databaseError('x')))
      expectErr(
        await CrmCnpjEnrichmentService.getForCompany(ACTOR, WS, 'c1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('enrich', () => {
    beforeEach(() => {
      companies.findById.mockResolvedValue(ok(company()))
    })

    it('fills a placeholder name and a missing address', async () => {
      const result = expectOk(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
      )
      expect(result.applied).toEqual(['name', 'address'])
      expect(result.company.name).toBe('Acme Mercado')
      expect(companies.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ name: 'Acme Mercado', updatedById: ACTOR }),
      )
      expect(enrichments.upsert).toHaveBeenCalledWith(
        'c1',
        WS,
        expect.objectContaining({ cnpj: VALID_CNPJ, source: 'brasilapi' }),
      )
      expect(indexSearchDocument).toHaveBeenCalledWith('crm-company', WS, 'c1')
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_cnpj_enrichment',
          targetId: 'c1',
        }),
      )
    })

    it('keeps a filled name and address unless overwrite is set', async () => {
      companies.findById.mockResolvedValue(
        ok(company({ name: 'Minha Acme', address: { city: 'Rio' } })),
      )
      const result = expectOk(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
      )
      expect(result.applied).toEqual([])
      expect(companies.update).not.toHaveBeenCalled()
      expect(result.company.name).toBe('Minha Acme')
      expect(indexSearchDocument).not.toHaveBeenCalled()
    })

    it('replaces name and address with overwrite', async () => {
      companies.findById.mockResolvedValue(
        ok(company({ name: 'Minha Acme', address: { city: 'Rio' } })),
      )
      const result = expectOk(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: true,
        }),
      )
      expect(result.applied).toEqual(['name', 'address'])
    })

    it('falls back to the legal name and skips an empty address', async () => {
      lookupMock.mockResolvedValue(
        ok(createFakeCnpjProfile({ tradeName: null, address: null })),
      )
      const result = expectOk(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
      )
      expect(result.applied).toEqual(['name'])
      expect(result.company.name).toBe('ACME COMERCIO DE ALIMENTOS LTDA')
    })

    it('treats a whitespace-only address object as empty', async () => {
      companies.findById.mockResolvedValue(
        ok(company({ name: 'Boa', address: { city: '  ' } })),
      )
      const result = expectOk(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
      )
      expect(result.applied).toEqual(['address'])
    })

    it('does not touch the name when the registry has none', async () => {
      lookupMock.mockResolvedValue(
        ok(createFakeCnpjProfile({ tradeName: null, legalName: null })),
      )
      const result = expectOk(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
      )
      expect(result.applied).toEqual(['address'])
    })

    it('fails on a company without a valid CNPJ', async () => {
      companies.findById.mockResolvedValue(ok(company({ cnpj: null })))
      expectErr(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
        'CRM_CNPJ_INVALID',
      )
      companies.findById.mockResolvedValue(ok(company({ cnpj: '123' })))
      expectErr(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
        'CRM_CNPJ_INVALID',
      )
    })

    it('propagates company lookup, provider, save and update errors', async () => {
      companies.findById.mockResolvedValueOnce(err(notFound('CrmCompany')))
      expectErr(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
        'RESOURCE_NOT_FOUND',
      )

      lookupMock.mockResolvedValueOnce(err(crmCnpjLookupFailed()))
      expectErr(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
        'CRM_CNPJ_LOOKUP_FAILED',
      )

      enrichments.upsert.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
        'DATABASE_ERROR',
      )

      companies.update.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmCnpjEnrichmentService.enrich(ACTOR, WS, 'c1', {
          overwrite: false,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('enrichCompany (worker entry)', () => {
    it('skips the authorization checks', async () => {
      members.findByUserAndWorkspace.mockResolvedValue(ok(null))
      const result = await enrichCompany({
        workspaceId: WS,
        actorId: ACTOR,
        company: company(),
        overwrite: false,
      })
      expect(result.ok).toBe(true)
    })
  })

  describe('startRun', () => {
    const dto = { onlyMissing: true, overwrite: false }

    beforeEach(() => {
      runs.findActive.mockResolvedValue(ok(null))
      runs.countTargets.mockResolvedValue(ok(7))
      runs.create.mockImplementation(async (data) =>
        ok(createFakeCnpjRun({ ...data, id: 'run1' })),
      )
    })

    it('creates the run and enqueues the job', async () => {
      const run = expectOk(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, dto),
      )
      expect(run).toMatchObject({ id: 'run1', total: 7, status: 'QUEUED' })
      expect(runs.create).toHaveBeenCalledWith({
        workspaceId: WS,
        createdById: ACTOR,
        onlyMissing: true,
        overwrite: false,
        total: 7,
      })
      expect(addJob).toHaveBeenCalledWith(
        'run-enrichment',
        { runId: 'run1' },
        { jobId: 'crm-cnpj-run-run1' },
      )
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', targetId: 'run1' }),
      )
    })

    it('allows only one active run per workspace', async () => {
      runs.findActive.mockResolvedValue(
        ok(createFakeCnpjRun({ status: 'RUNNING' })),
      )
      expectErr(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, dto),
        'CRM_CNPJ_RUN_ACTIVE',
      )
      expect(runs.create).not.toHaveBeenCalled()
    })

    it('marks the run failed when the queue is down', async () => {
      addJob.mockRejectedValue(new Error('redis down'))
      runs.update.mockResolvedValue(
        ok(createFakeCnpjRun({ id: 'run1', status: 'FAILED', error: 'x' })),
      )
      const run = expectOk(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, dto),
      )
      expect(run.status).toBe('FAILED')
      expect(runs.update).toHaveBeenCalledWith(
        'run1',
        expect.objectContaining({ status: 'FAILED' }),
      )
    })

    it('still answers when the failed-run update also fails', async () => {
      addJob.mockRejectedValue('weird')
      runs.update.mockResolvedValue(err(databaseError('x')))
      const run = expectOk(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, dto),
      )
      expect(run.id).toBe('run1')
    })

    it('propagates repository errors', async () => {
      runs.findActive.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, dto),
        'DATABASE_ERROR',
      )
      runs.countTargets.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, dto),
        'DATABASE_ERROR',
      )
      runs.create.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmCnpjEnrichmentService.startRun(ACTOR, WS, dto),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listRuns / getRun', () => {
    it('lists runs as DTOs', async () => {
      runs.listByWorkspace.mockResolvedValue(
        ok([createFakeCnpjRun({ id: 'r1' })]),
      )
      const list = expectOk(
        await CrmCnpjEnrichmentService.listRuns(ACTOR, WS, { limit: 3 }),
      )
      expect(list.map((r) => r.id)).toEqual(['r1'])
      expect(runs.listByWorkspace).toHaveBeenCalledWith(WS, 3)
    })

    it('propagates list errors', async () => {
      runs.listByWorkspace.mockResolvedValue(err(databaseError('x')))
      expectErr(
        await CrmCnpjEnrichmentService.listRuns(ACTOR, WS, { limit: 3 }),
        'DATABASE_ERROR',
      )
    })

    it('gets one run scoped to the workspace', async () => {
      runs.findById.mockResolvedValue(ok(createFakeCnpjRun({ id: 'r1' })))
      expect(
        expectOk(await CrmCnpjEnrichmentService.getRun(ACTOR, WS, 'r1')).id,
      ).toBe('r1')
      expect(runs.findById).toHaveBeenCalledWith('r1', WS)
    })

    it('propagates a missing run', async () => {
      runs.findById.mockResolvedValue(
        err({ code: 'CRM_CNPJ_RUN_NOT_FOUND', message: 'x' }),
      )
      expectErr(
        await CrmCnpjEnrichmentService.getRun(ACTOR, WS, 'nope'),
        'CRM_CNPJ_RUN_NOT_FOUND',
      )
    })
  })

  describe('cancelRun', () => {
    it('asks the repository to cancel and audits it', async () => {
      asRole('ADMIN')
      runs.requestCancel.mockResolvedValue(
        ok(
          createFakeCnpjRun({
            id: 'r1',
            status: 'RUNNING',
            cancelRequestedAt: new Date(),
          }),
        ),
      )
      const dto = expectOk(
        await CrmCnpjEnrichmentService.cancelRun(ACTOR, WS, 'r1'),
      )
      expect(dto).toMatchObject({ id: 'r1', cancelRequested: true })
      expect(runs.requestCancel).toHaveBeenCalledWith('r1', WS)
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_cnpj_enrichment',
          action: 'cancel',
          targetId: 'r1',
        }),
      )
    })

    it('propagates a run that is not cancelable or not found', async () => {
      asRole('OWNER')
      runs.requestCancel.mockResolvedValue(err(crmCnpjRunNotCancelable()))
      expectErr(
        await CrmCnpjEnrichmentService.cancelRun(ACTOR, WS, 'r1'),
        'CRM_CNPJ_RUN_NOT_CANCELABLE',
      )
      expect(auditMutation).not.toHaveBeenCalled()
    })
  })
})
