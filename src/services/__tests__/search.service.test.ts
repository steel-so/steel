import type { ModuleKind, Profile } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { createFakeWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, sdNotAgent } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { SearchDocumentHit } from '@/src/lib/search/search-document'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/repositories/search-document.repository')
vi.mock('@/src/repositories/search-source.repository')
vi.mock('@/src/services/sd-access')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SearchDocumentRepository } from '@/src/repositories/search-document.repository'
import {
  type SdTicketSearchRow,
  SearchSourceRepository,
} from '@/src/repositories/search-source.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { SdAccess, type SdAccessContext } from '@/src/services/sd-access'
import { SearchService } from '../search.service'

const memberships = vi.mocked(MembershipRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const modules = vi.mocked(WorkspaceModuleAccessRepository)
const docs = vi.mocked(SearchDocumentRepository)
const sources = vi.mocked(SearchSourceRepository)
const sd = vi.mocked(SdAccess)

const WS = 'ws1'
const USER = 'u1'

function member(role: 'OWNER' | 'MEMBER' | 'VIEWER', profile?: Profile) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(
      createFakeMembership({
        userId: USER,
        workspaceId: WS,
        role,
        profile: profile ?? null,
      }),
    ),
  )
}

function enable(...kinds: ModuleKind[]) {
  modules.listByWorkspace.mockResolvedValue(
    ok(
      kinds.map((module) =>
        createFakeWorkspaceModuleAccess({ workspaceId: WS, module }),
      ),
    ),
  )
}

function sdAgent(isAgent: boolean) {
  sd.resolve.mockResolvedValue(ok({ isAgent } as unknown as SdAccessContext))
}

function hit(overrides: Partial<SearchDocumentHit> = {}): SearchDocumentHit {
  return {
    entityType: 'crm-lead',
    entityId: 'l1',
    module: 'CRM',
    title: 'Agro Telecom',
    subtitle: null,
    body: null,
    path: '/crm/leads?record=l1',
    updatedAt: new Date(),
    exact: false,
    titlePrefix: true,
    titlePhrase: true,
    textRank: 0.4,
    similarity: 1,
    isMine: false,
    ...overrides,
  }
}

function ticketRow(
  id: string,
  overrides: Partial<SdTicketSearchRow> = {},
): SdTicketSearchRow {
  return {
    id,
    number: 1,
    type: 'INCIDENT',
    title: 't',
    description: null,
    requesterId: null,
    assigneeId: null,
    updatedAt: new Date(),
    phase: { name: 'Novo' },
    requester: null,
    customer: null,
    company: null,
    contact: null,
    participants: [],
    ...overrides,
  }
}

beforeEach(() => {
  workspaces.findById.mockResolvedValue(
    // The whiteboard switch has its own case below.
    ok(createFakeWorkspace({ id: WS, slug: 'agro', whiteboardEnabled: false })),
  )
  docs.search.mockResolvedValue(ok([]))
})

describe('SearchService.resolveAccess()', () => {
  it('should add whiteboards only while the workspace switch is on', async () => {
    member('VIEWER')
    enable()
    workspaces.findById.mockResolvedValueOnce(
      ok(
        createFakeWorkspace({ id: WS, slug: 'agro', whiteboardEnabled: true }),
      ),
    )

    const access = expectOk(await SearchService.resolveAccess(USER, WS))
    expect(access.types).toEqual(['member', 'whiteboard'])
  })

  it('should deny a non-member before anything else', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await SearchService.resolveAccess(USER, WS), 'FORBIDDEN')
    expect(modules.listByWorkspace).not.toHaveBeenCalled()
  })

  it('should give an owner every type of the enabled modules', async () => {
    member('OWNER')
    enable('SERVICE_DESK', 'CRM', 'COMMUNICATION')
    sdAgent(true)

    const access = expectOk(await SearchService.resolveAccess(USER, WS))
    expect(access.slug).toBe('agro')
    expect(access.isSdAgent).toBe(true)
    expect(access.types).toHaveLength(15)
  })

  it('should drop the types of disabled modules', async () => {
    member('OWNER')
    enable('CRM')

    const access = expectOk(await SearchService.resolveAccess(USER, WS))
    expect(access.types).toEqual([
      'crm-lead',
      'crm-opportunity',
      'crm-person',
      'crm-company',
      'crm-task',
      'crm-proposal',
      'crm-document',
      'member',
    ])
    expect(sd.resolve).not.toHaveBeenCalled()
  })

  it('should keep only ticket and KB types for a ServiceDesk requester', async () => {
    member('MEMBER')
    enable('SERVICE_DESK')
    sdAgent(false)

    const access = expectOk(await SearchService.resolveAccess(USER, WS))
    expect(access.types).toEqual(['sd-ticket', 'sd-kb-article', 'member'])
    expect(access.isSdAgent).toBe(false)
  })

  it('should apply RBAC VIEW of a custom profile (deny by default)', async () => {
    member('MEMBER', {
      id: 'p1',
      workspaceId: WS,
      name: 'Só leads',
      isSystem: false,
      systemKey: null,
      permissions: { leads: ['VIEW'], conversations: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    enable('CRM', 'COMMUNICATION')

    const access = expectOk(await SearchService.resolveAccess(USER, WS))
    expect(access.types).toEqual(['crm-lead', 'member'])
  })

  it('should deny resources when the profile has no matrix', async () => {
    member('MEMBER', {
      id: 'p1',
      workspaceId: WS,
      name: 'Vazio',
      isSystem: false,
      systemKey: null,
      permissions: null as unknown as Profile['permissions'],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    enable('CRM')

    const access = expectOk(await SearchService.resolveAccess(USER, WS))
    expect(access.types).toEqual(['member'])
  })

  it('should propagate workspace, module and ServiceDesk errors', async () => {
    member('OWNER')
    enable('SERVICE_DESK')
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await SearchService.resolveAccess(USER, WS), 'DATABASE_ERROR')

    modules.listByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await SearchService.resolveAccess(USER, WS), 'DATABASE_ERROR')

    sd.resolve.mockResolvedValueOnce(err(sdNotAgent()))
    expectErr(await SearchService.resolveAccess(USER, WS), 'SD_NOT_AGENT')
  })
})

describe('SearchService.search()', () => {
  beforeEach(() => {
    member('OWNER')
    enable('SERVICE_DESK', 'CRM', 'COMMUNICATION')
    sdAgent(true)
  })

  it('should query the allowed types and rank exact matches first', async () => {
    docs.search.mockResolvedValue(
      ok([
        hit({
          entityId: 'fuzzy',
          titlePrefix: false,
          titlePhrase: false,
          textRank: 0,
          similarity: 0.6,
        }),
        hit({
          entityType: 'sd-ticket',
          entityId: 't1',
          module: 'SERVICE_DESK',
          exact: true,
          titlePrefix: false,
          path: '/servicedesk/tickets/1',
        }),
        hit({ entityId: 'prefix' }),
      ]),
    )

    const res = expectOk(
      await SearchService.search(USER, WS, { q: ' INC-000001 ', limit: 2 }),
    )

    expect(res.results.map((r) => r.id)).toEqual(['t1', 'prefix'])
    expect(res.results[0]).toMatchObject({
      href: '/agro/servicedesk/tickets/1',
      group: 'Chamados',
    })
    expect(res.query).toBe(' INC-000001 ')
    expect(docs.search).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        userId: USER,
        text: 'inc-000001',
        codes: ['inc-000001', 'inc-1'],
        isSdAgent: true,
        candidateLimit: 60,
      }),
    )
    expect(docs.search.mock.calls[0][0].types).toHaveLength(15)
  })

  it('should narrow to the requested types the user may see', async () => {
    member('MEMBER')
    enable('CRM')
    await SearchService.search(USER, WS, {
      q: 'agro',
      types: ['crm-lead', 'sd-ticket'],
      limit: 50,
    })
    expect(docs.search).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['crm-lead'], candidateLimit: 200 }),
    )
  })

  it('should not hit the index for one letter or when nothing is allowed', async () => {
    expectOk(await SearchService.search(USER, WS, { q: 'a' })).results
    enable()
    member('MEMBER', {
      id: 'p',
      workspaceId: WS,
      name: 'x',
      isSystem: false,
      systemKey: null,
      permissions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const none = expectOk(
      await SearchService.search(USER, WS, { q: 'agro', types: ['crm-lead'] }),
    )
    expect(none.results).toEqual([])
    expect(docs.search).not.toHaveBeenCalled()
  })

  it('should search a single digit (ticket number)', async () => {
    await SearchService.search(USER, WS, { q: '7' })
    expect(docs.search).toHaveBeenCalledWith(
      expect.objectContaining({ text: '7', codes: ['7'] }),
    )
  })

  it('should propagate access and repository errors', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await SearchService.search(USER, WS, { q: 'agro' }), 'FORBIDDEN')

    docs.search.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchService.search(USER, WS, { q: 'agro' }),
      'DATABASE_ERROR',
    )
  })

  it('should re-check ticket visibility for requesters (stale index)', async () => {
    member('MEMBER')
    enable('SERVICE_DESK')
    sdAgent(false)
    docs.search.mockResolvedValue(
      ok([
        hit({
          entityType: 'sd-ticket',
          entityId: 'mine',
          module: 'SERVICE_DESK',
        }),
        hit({
          entityType: 'sd-ticket',
          entityId: 'participant',
          module: 'SERVICE_DESK',
        }),
        hit({
          entityType: 'sd-ticket',
          entityId: 'contact',
          module: 'SERVICE_DESK',
        }),
        hit({
          entityType: 'sd-ticket',
          entityId: 'stale',
          module: 'SERVICE_DESK',
        }),
        hit({
          entityType: 'sd-kb-article',
          entityId: 'kb',
          module: 'SERVICE_DESK',
        }),
      ]),
    )
    sources.sdTickets.mockResolvedValue(
      ok([
        ticketRow('mine', { requesterId: USER }),
        ticketRow('participant', { participants: [{ userId: USER }] }),
        ticketRow('contact', { contact: { name: 'c', userId: USER } }),
        ticketRow('stale', { requesterId: 'other' }),
      ]),
    )

    const res = expectOk(
      await SearchService.search(USER, WS, { q: 'impressora' }),
    )

    expect(res.results.map((r) => r.id).sort()).toEqual([
      'contact',
      'kb',
      'mine',
      'participant',
    ])
    expect(sources.sdTickets).toHaveBeenCalledWith(WS, {
      ids: ['mine', 'participant', 'contact', 'stale'],
      take: 4,
    })
  })

  it('should propagate the visibility re-check error', async () => {
    member('MEMBER')
    enable('SERVICE_DESK')
    sdAgent(false)
    docs.search.mockResolvedValue(
      ok([
        hit({ entityType: 'sd-ticket', entityId: 't', module: 'SERVICE_DESK' }),
      ]),
    )
    sources.sdTickets.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SearchService.search(USER, WS, { q: 'impressora' }),
      'DATABASE_ERROR',
    )
  })

  it('should skip the re-check for agents and hits without tickets', async () => {
    docs.search.mockResolvedValue(ok([hit()]))
    expectOk(await SearchService.search(USER, WS, { q: 'agro' }))
    expect(sources.sdTickets).not.toHaveBeenCalled()

    expectOk(
      await SearchService.dropUnviewableTickets(USER, WS, false, [hit()]),
    )
    expect(sources.sdTickets).not.toHaveBeenCalled()
  })
})
