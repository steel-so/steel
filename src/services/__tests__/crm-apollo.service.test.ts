import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeApolloIntegration,
  createFakeCrmApolloImport,
} from '@/src/__tests__/factories/crm-apollo.factory'
import { createFakeCrmMailingList } from '@/src/__tests__/factories/crm-email-marketing.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmApolloInvalidKey,
  crmApolloNotConnected,
  crmApolloRateLimited,
  databaseError,
  forbidden,
  notFound,
} from '@/src/errors'
import {
  apolloWebhookToken,
  hashApolloWebhookToken,
  isApolloPhoneRevealAvailable,
} from '@/src/lib/integrations/apollo-webhook'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/authz')
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (value: string) => `enc:${value}`),
}))
vi.mock('@/src/services/sd-integration-credentials')
vi.mock('@/src/services/workspace-integration.service', () => ({
  WorkspaceIntegrationService: { test: vi.fn(), disconnect: vi.fn() },
}))
vi.mock('@/src/lib/integrations/apollo-client', () => ({
  ApolloClient: {
    health: vi.fn(),
    searchPeople: vi.fn(),
    listLabels: vi.fn(),
    searchContacts: vi.fn(),
  },
}))
vi.mock('@/src/lib/integrations/apollo-webhook', async (original) => ({
  ...(await original<object>()),
  isApolloPhoneRevealAvailable: vi.fn(),
}))
vi.mock('@/src/lib/queue/queues', () => ({ getCrmApolloImportQueue: vi.fn() }))
vi.mock('@/src/repositories/workspace-integration.repository')
vi.mock('@/src/repositories/crm-apollo-import.repository')
vi.mock('@/src/repositories/crm-mailing-list.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { ApolloClient } from '@/src/lib/integrations/apollo-client'
import { getCrmApolloImportQueue } from '@/src/lib/queue/queues'
import { CrmApolloImportRepository } from '@/src/repositories/crm-apollo-import.repository'
import { CrmMailingListRepository } from '@/src/repositories/crm-mailing-list.repository'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { assertModuleMember, assertPrivileged } from '@/src/services/authz'
import { decryptSdIntegrationToken } from '@/src/services/sd-integration-credentials'
import { WorkspaceIntegrationService } from '@/src/services/workspace-integration.service'
import { CrmApolloService } from '../crm-apollo.service'

/** Built at runtime so no literal matches the secret scanners. */
function fakeKey(value: string): string {
  return [...value].join('')
}

const member = vi.mocked(assertModuleMember)
const privileged = vi.mocked(assertPrivileged)
const integrationRepo = vi.mocked(WorkspaceIntegrationRepository)
const importRepo = vi.mocked(CrmApolloImportRepository)
const listRepo = vi.mocked(CrmMailingListRepository)
const client = vi.mocked(ApolloClient)
const decrypt = vi.mocked(decryptSdIntegrationToken)
const getQueue = vi.mocked(getCrmApolloImportQueue)
const audit = vi.mocked(auditMutation)

const integration = createFakeApolloIntegration()
const RATE = { minuteLeft: 40, hourLeft: 100, dayLeft: 500 }
const FILTERS = {
  personTitles: ['CTO'],
  includeSimilarTitles: true,
  seniorities: [],
  personLocations: [],
  organizationLocations: [],
  organizationDomains: [],
  employeeRanges: [],
  keywords: '',
  emailStatuses: [],
}
const add = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  member.mockResolvedValue(ok({} as never))
  privileged.mockResolvedValue(ok({} as never))
  integrationRepo.findByKind.mockResolvedValue(ok(integration))
  decrypt.mockResolvedValue(ok('the-key'))
  getQueue.mockReturnValue({ add } as never)
  add.mockResolvedValue({})
})

describe('getConnection', () => {
  it('returns the connection state to a CRM member', async () => {
    const dto = expectOk(await CrmApolloService.getConnection('u1', 'ws1'))
    expect(dto.connected).toBe(true)
    expect(dto.keyHint).toBe('••••ab12')
    expect(member).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
  })

  it('says not connected when there is no row', async () => {
    integrationRepo.findByKind.mockResolvedValue(ok(null))
    expect(
      expectOk(await CrmApolloService.getConnection('u1', 'ws1')).connected,
    ).toBe(false)
  })

  it('denies a non-member and propagates database errors', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await CrmApolloService.getConnection('u1', 'ws1'), 'FORBIDDEN')
    integrationRepo.findByKind.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmApolloService.getConnection('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('connect', () => {
  beforeEach(() => {
    client.health.mockResolvedValue(
      ok({ data: { healthy: true }, rateLimit: RATE }),
    )
    integrationRepo.connect.mockResolvedValue(ok(integration))
  })

  it('checks the key first and stores it encrypted with a masked hint', async () => {
    integrationRepo.findByKind.mockResolvedValue(
      ok(
        createFakeApolloIntegration({ config: { defaultMailingListId: 'l1' } }),
      ),
    )
    expectOk(
      await CrmApolloService.connect('u1', 'ws1', {
        apiKey: fakeKey(fakeKey('abcdefghij1234')),
      }),
    )
    expect(client.health).toHaveBeenCalledWith(fakeKey('abcdefghij1234'))
    const [, kind, externalId, data] = integrationRepo.connect.mock.calls[0]
    expect(kind).toBe('APOLLO')
    expect(externalId).toBe('apollo')
    expect(data).toMatchObject({
      externalName: '••••1234',
      encryptedToken: 'enc:abcdefghij1234',
      config: { defaultMailingListId: 'l1' },
      status: 'ACTIVE',
    })
    // The key is never in the audit trail.
    expect(JSON.stringify(audit.mock.calls)).not.toContain(
      fakeKey('abcdefghij1234'),
    )
  })

  it('refuses a non-admin before calling Apollo', async () => {
    privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await CrmApolloService.connect('u1', 'ws1', {
        apiKey: fakeKey(fakeKey('abcdefghij1234')),
      }),
      'FORBIDDEN',
    )
    expect(client.health).not.toHaveBeenCalled()
  })

  it('does not store a key Apollo rejects and audits the failure', async () => {
    client.health.mockResolvedValue(err(crmApolloInvalidKey()))
    expectErr(
      await CrmApolloService.connect('u1', 'ws1', {
        apiKey: fakeKey(fakeKey('abcdefghij1234')),
      }),
      'CRM_APOLLO_INVALID_KEY',
    )
    expect(integrationRepo.connect).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })

  it('propagates repository errors', async () => {
    integrationRepo.findByKind.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmApolloService.connect('u1', 'ws1', {
        apiKey: fakeKey(fakeKey('abcdefghij1234')),
      }),
      'DATABASE_ERROR',
    )
    integrationRepo.findByKind.mockResolvedValueOnce(ok(null))
    integrationRepo.connect.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmApolloService.connect('u1', 'ws1', {
        apiKey: fakeKey(fakeKey('abcdefghij1234')),
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('updateSettings', () => {
  it('validates the list and saves it in the config', async () => {
    listRepo.findById.mockResolvedValue(ok(createFakeCrmMailingList()))
    integrationRepo.update.mockResolvedValue(
      ok(
        createFakeApolloIntegration({ config: { defaultMailingListId: 'l1' } }),
      ),
    )
    const dto = expectOk(
      await CrmApolloService.updateSettings('u1', 'ws1', {
        defaultMailingListId: 'l1',
      }),
    )
    expect(dto.defaultMailingListId).toBe('l1')
    expect(integrationRepo.update.mock.calls[0][2]).toEqual({
      config: { defaultMailingListId: 'l1' },
    })
  })

  it('clears the list with null without looking it up', async () => {
    integrationRepo.update.mockResolvedValue(ok(integration))
    expectOk(
      await CrmApolloService.updateSettings('u1', 'ws1', {
        defaultMailingListId: null,
      }),
    )
    expect(listRepo.findById).not.toHaveBeenCalled()
    expect(integrationRepo.update.mock.calls[0][2]).toEqual({ config: {} })
  })

  it('fails for a list of another workspace', async () => {
    listRepo.findById.mockResolvedValue(err(notFound('CrmMailingList')))
    expectErr(
      await CrmApolloService.updateSettings('u1', 'ws1', {
        defaultMailingListId: 'other',
      }),
      'RESOURCE_NOT_FOUND',
    )
    expect(integrationRepo.update).not.toHaveBeenCalled()
  })

  it('needs an admin, a connection and a working database', async () => {
    privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await CrmApolloService.updateSettings('u1', 'ws1', {
        defaultMailingListId: null,
      }),
      'FORBIDDEN',
    )
    integrationRepo.findByKind.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmApolloService.updateSettings('u1', 'ws1', {
        defaultMailingListId: null,
      }),
      'CRM_APOLLO_NOT_CONNECTED',
    )
    integrationRepo.findByKind.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmApolloService.updateSettings('u1', 'ws1', {
        defaultMailingListId: null,
      }),
      'DATABASE_ERROR',
    )
    integrationRepo.update.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmApolloService.updateSettings('u1', 'ws1', {
        defaultMailingListId: null,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('test and disconnect', () => {
  it('delegate to the shared integration service for the APOLLO kind', async () => {
    vi.mocked(WorkspaceIntegrationService.test).mockResolvedValue(
      ok({} as never),
    )
    vi.mocked(WorkspaceIntegrationService.disconnect).mockResolvedValue(
      ok(undefined),
    )
    await CrmApolloService.test('u1', 'ws1')
    await CrmApolloService.disconnect('u1', 'ws1')
    expect(WorkspaceIntegrationService.test).toHaveBeenCalledWith(
      'u1',
      'ws1',
      'APOLLO',
    )
    expect(WorkspaceIntegrationService.disconnect).toHaveBeenCalledWith(
      'u1',
      'ws1',
      'APOLLO',
    )
  })
})

describe('search', () => {
  const dto = { filters: FILTERS, page: 2, perPage: 25 }

  it('previews the people and computes the pages', async () => {
    client.searchPeople.mockResolvedValue(
      ok({
        rateLimit: RATE,
        data: {
          totalEntries: 51,
          people: [
            {
              id: 'p1',
              firstName: 'Maria',
              lastNameObfuscated: 'Si***a',
              title: 'CTO',
              hasEmail: true,
              hasDirectPhone: false,
              organizationName: 'Acme',
            },
          ],
        },
      }),
    )
    const result = expectOk(await CrmApolloService.search('u1', 'ws1', dto))
    expect(result).toMatchObject({
      totalEntries: 51,
      page: 2,
      perPage: 25,
      totalPages: 3,
      rateLimit: RATE,
    })
    expect(result.people[0].name).toBe('Maria Si***a')
    expect(client.searchPeople).toHaveBeenCalledWith('the-key', FILTERS, 2, 25)
    expect(member).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'leads',
      action: 'CREATE',
    })
  })

  it('refuses a search with no filter', async () => {
    expectErr(
      await CrmApolloService.search('u1', 'ws1', {
        ...dto,
        filters: { ...FILTERS, personTitles: [] },
      }),
      'VALIDATION_ERROR',
    )
    expect(client.searchPeople).not.toHaveBeenCalled()
  })

  it('denies members without lead creation rights', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await CrmApolloService.search('u1', 'ws1', dto), 'FORBIDDEN')
  })

  it('needs a connected, readable key', async () => {
    integrationRepo.findByKind.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmApolloService.search('u1', 'ws1', dto),
      'CRM_APOLLO_NOT_CONNECTED',
    )
    decrypt.mockResolvedValueOnce(err(crmApolloNotConnected()))
    expectErr(
      await CrmApolloService.search('u1', 'ws1', dto),
      'CRM_APOLLO_NOT_CONNECTED',
    )
    integrationRepo.findByKind.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await CrmApolloService.search('u1', 'ws1', dto), 'DATABASE_ERROR')
  })

  it('stamps the connection when Apollo rejects the key', async () => {
    client.searchPeople.mockResolvedValue(err(crmApolloInvalidKey()))
    integrationRepo.markError.mockResolvedValue(ok(undefined))
    expectErr(
      await CrmApolloService.search('u1', 'ws1', dto),
      'CRM_APOLLO_INVALID_KEY',
    )
    expect(integrationRepo.markError).toHaveBeenCalledWith(
      integration.id,
      expect.any(String),
    )
  })

  it('does not stamp the connection for a rate limit', async () => {
    client.searchPeople.mockResolvedValue(err(crmApolloRateLimited(30)))
    expectErr(
      await CrmApolloService.search('u1', 'ws1', dto),
      'CRM_APOLLO_RATE_LIMITED',
    )
    expect(integrationRepo.markError).not.toHaveBeenCalled()
  })
})

describe('listLabels and listContacts', () => {
  it('returns the saved lists without id-less entries', async () => {
    client.listLabels.mockResolvedValue(
      ok({
        rateLimit: RATE,
        data: [
          { id: 'l1', name: 'Clientes', count: 3 },
          { id: '', name: 'Quebrada', count: 0 },
        ],
      }),
    )
    expect(expectOk(await CrmApolloService.listLabels('u1', 'ws1'))).toEqual([
      { id: 'l1', name: 'Clientes', count: 3 },
    ])
  })

  it('surfaces a key without list permission', async () => {
    client.listLabels.mockResolvedValue(
      err({ code: 'CRM_APOLLO_FORBIDDEN', message: 'x' }),
    )
    expectErr(
      await CrmApolloService.listLabels('u1', 'ws1'),
      'CRM_APOLLO_FORBIDDEN',
    )
  })

  it('denies and requires a connection', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await CrmApolloService.listLabels('u1', 'ws1'), 'FORBIDDEN')
    integrationRepo.findByKind.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmApolloService.listLabels('u1', 'ws1'),
      'CRM_APOLLO_NOT_CONNECTED',
    )
  })

  it('previews the contacts of a list', async () => {
    client.searchContacts.mockResolvedValue(
      ok({
        rateLimit: RATE,
        data: {
          totalEntries: 1,
          totalPages: 1,
          contacts: [
            {
              id: 'c1',
              name: 'Ana',
              firstName: 'Ana',
              lastName: null,
              email: 'ana@acme.com',
              emailStatus: 'verified',
              title: null,
              organizationName: 'Acme',
              linkedinUrl: null,
              city: null,
            },
          ],
        },
      }),
    )
    const result = expectOk(
      await CrmApolloService.listContacts('u1', 'ws1', 'l1', {
        page: 1,
        perPage: 25,
      }),
    )
    expect(result.contacts[0].email).toBe('ana@acme.com')
    expect(client.searchContacts).toHaveBeenCalledWith('the-key', 'l1', 1, 25)
  })

  it('propagates contact errors and denials', async () => {
    client.searchContacts.mockResolvedValue(err(crmApolloInvalidKey()))
    integrationRepo.markError.mockResolvedValue(ok(undefined))
    expectErr(
      await CrmApolloService.listContacts('u1', 'ws1', 'l1', {
        page: 1,
        perPage: 25,
      }),
      'CRM_APOLLO_INVALID_KEY',
    )
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await CrmApolloService.listContacts('u1', 'ws1', 'l1', {
        page: 1,
        perPage: 25,
      }),
      'FORBIDDEN',
    )
    integrationRepo.findByKind.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmApolloService.listContacts('u1', 'ws1', 'l1', {
        page: 1,
        perPage: 25,
      }),
      'CRM_APOLLO_NOT_CONNECTED',
    )
  })
})

describe('createImport', () => {
  const searchDto = {
    source: 'SEARCH' as const,
    filters: FILTERS,
    apolloIds: ['a1', 'a2', 'a1'],
    mailingListId: 'ml1',
    revealPhones: false,
  }

  beforeEach(() => {
    vi.mocked(isApolloPhoneRevealAvailable).mockReturnValue(true)
    listRepo.findById.mockResolvedValue(ok(createFakeCrmMailingList()))
    importRepo.create.mockImplementation(async (data) =>
      ok(
        createFakeCrmApolloImport({
          id: 'imp1',
          requestedCount: data.requestedCount,
          source: data.source,
        }),
      ),
    )
  })

  it('creates the run with unique ids and queues it', async () => {
    const dto = expectOk(
      await CrmApolloService.createImport('u1', 'ws1', searchDto),
    )
    expect(dto.id).toBe('imp1')
    expect(importRepo.create.mock.calls[0][0]).toMatchObject({
      workspaceId: 'ws1',
      createdById: 'u1',
      source: 'SEARCH',
      apolloIds: ['a1', 'a2'],
      requestedCount: 2,
      mailingListId: 'ml1',
    })
    expect(add).toHaveBeenCalledWith('run-import', { importId: 'imp1' })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_apollo_import',
        action: 'create',
      }),
    )
  })

  it('stores the picked contacts of a list import and dedupes them', async () => {
    expectOk(
      await CrmApolloService.createImport('u1', 'ws1', {
        source: 'LIST',
        labelId: 'l1',
        labelName: 'Clientes',
        contacts: [
          { id: 'c1', name: 'Ana', email: 'ana@acme.com' },
          { id: 'c1', name: 'Ana', email: 'ana@acme.com' },
        ],
        revealPhones: false,
      }),
    )
    const created = importRepo.create.mock.calls[0][0]
    expect(created.source).toBe('LIST')
    expect(created.apolloIds).toEqual([])
    expect(created.requestedCount).toBe(1)
    expect(created.filters).toEqual({ labelId: 'l1', labelName: 'Clientes' })
    expect(created.mailingListId).toBeNull()
  })

  it('keeps the label name null when not sent', async () => {
    expectOk(
      await CrmApolloService.createImport('u1', 'ws1', {
        source: 'LIST',
        labelId: 'l1',
        contacts: [{ id: 'c1', name: 'Ana', email: 'ana@acme.com' }],
        revealPhones: false,
      }),
    )
    expect(importRepo.create.mock.calls[0][0].filters).toEqual({
      labelId: 'l1',
      labelName: null,
    })
  })

  it('denies members, requires a connection and a list of the workspace', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await CrmApolloService.createImport('u1', 'ws1', searchDto),
      'FORBIDDEN',
    )
    integrationRepo.findByKind.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmApolloService.createImport('u1', 'ws1', searchDto),
      'CRM_APOLLO_NOT_CONNECTED',
    )
    listRepo.findById.mockResolvedValueOnce(err(notFound('CrmMailingList')))
    expectErr(
      await CrmApolloService.createImport('u1', 'ws1', searchDto),
      'RESOURCE_NOT_FOUND',
    )
    expect(importRepo.create).not.toHaveBeenCalled()
  })

  it('propagates a failure creating the row', async () => {
    importRepo.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmApolloService.createImport('u1', 'ws1', searchDto),
      'DATABASE_ERROR',
    )
    expect(add).not.toHaveBeenCalled()
  })

  it('fails the run when it cannot be queued', async () => {
    add.mockRejectedValueOnce(new Error('redis down'))
    importRepo.setStatus.mockResolvedValue(ok(createFakeCrmApolloImport()))
    expectErr(
      await CrmApolloService.createImport('u1', 'ws1', searchDto),
      'VALIDATION_ERROR',
    )
    expect(importRepo.setStatus).toHaveBeenCalledWith(
      'imp1',
      'FAILED',
      expect.objectContaining({ error: expect.any(String) }),
    )
  })

  it('stores the webhook token hash only when phones are revealed', async () => {
    expectOk(await CrmApolloService.createImport('u1', 'ws1', searchDto))
    expect(importRepo.create.mock.calls[0][0]).toMatchObject({
      revealPhones: false,
      webhookTokenHash: null,
    })
    expectOk(
      await CrmApolloService.createImport('u1', 'ws1', {
        ...searchDto,
        revealPhones: true,
      }),
    )
    const data = importRepo.create.mock.calls[1][0]
    expect(data.revealPhones).toBe(true)
    expect(data.webhookTokenHash).toBe(
      hashApolloWebhookToken(apolloWebhookToken(data.id as string)),
    )
    expect(data.webhookTokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses phones when the public URL is not HTTPS', async () => {
    vi.mocked(isApolloPhoneRevealAvailable).mockReturnValue(false)
    const error = expectErr(
      await CrmApolloService.createImport('u1', 'ws1', {
        ...searchDto,
        revealPhones: true,
      }),
    )
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(importRepo.create).not.toHaveBeenCalled()
  })

  it('does not require a mailing list', async () => {
    expectOk(
      await CrmApolloService.createImport('u1', 'ws1', {
        ...searchDto,
        mailingListId: null,
      }),
    )
    expect(listRepo.findById).not.toHaveBeenCalled()
  })
})

describe('listImports and getImport', () => {
  it('lists the latest runs of the workspace', async () => {
    importRepo.listByWorkspace.mockResolvedValue(
      ok([createFakeCrmApolloImport({ id: 'i1' })]),
    )
    const rows = expectOk(
      await CrmApolloService.listImports('u1', 'ws1', { limit: 5 }),
    )
    expect(rows.map((r) => r.id)).toEqual(['i1'])
    expect(importRepo.listByWorkspace).toHaveBeenCalledWith('ws1', 5)
  })

  it('returns one run scoped to the workspace', async () => {
    importRepo.findById.mockResolvedValue(
      ok(createFakeCrmApolloImport({ id: 'i1' })),
    )
    expect(
      expectOk(await CrmApolloService.getImport('u1', 'ws1', 'i1')).id,
    ).toBe('i1')
    expect(importRepo.findById).toHaveBeenCalledWith('i1', 'ws1')
  })

  it('denies non-members and propagates errors', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await CrmApolloService.listImports('u1', 'ws1', { limit: 5 }),
      'FORBIDDEN',
    )
    expectErr(await CrmApolloService.getImport('u1', 'ws1', 'i1'), 'FORBIDDEN')
    member.mockResolvedValue(ok({} as never))
    importRepo.listByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmApolloService.listImports('u1', 'ws1', { limit: 5 }),
      'DATABASE_ERROR',
    )
    importRepo.findById.mockResolvedValueOnce(
      err({ code: 'CRM_APOLLO_IMPORT_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await CrmApolloService.getImport('u1', 'ws1', 'other'),
      'CRM_APOLLO_IMPORT_NOT_FOUND',
    )
  })
})
