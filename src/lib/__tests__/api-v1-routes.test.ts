import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Each /api/v1 handler is a thin mapping over an existing service: these
// tests pin that mapping (arguments in, envelope out). Auth, scope, module
// and limits are covered in api-v1-route.test.ts; HTTP refusals in the e2e.

vi.mock('@/lib/axiom/server', () => ({
  withAxiom: (handler: unknown) => handler,
}))
vi.mock('@/src/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/api/session')>()),
  resolveApiSession: vi.fn(),
}))
vi.mock('@/src/lib/rate-limit', () => ({
  apiLimiter: {},
  consume: vi.fn(async () => ({ ok: true, value: undefined })),
}))
vi.mock('@/src/lib/consent', () => ({
  requireConsent: vi.fn(async () => ({ ok: true, value: true })),
}))
vi.mock('@/src/services/api-v1.service', () => ({
  ApiV1Service: {
    me: vi.fn(),
    listPipelines: vi.fn(),
    importLeads: vi.fn(),
    sendWhatsAppTemplate: vi.fn(),
    listSdPhases: vi.fn(),
  },
}))
vi.mock('@/src/services/sd-ticket.service', () => ({
  SdTicketService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    movePhase: vi.fn(),
  },
}))
vi.mock('@/src/services/sd-ticket-message.service', () => ({
  SdTicketMessageService: { create: vi.fn() },
}))
vi.mock('@/src/services/sd-category.service', () => ({
  SdCategoryService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-lead.service', () => ({
  CrmLeadService: { list: vi.fn(), create: vi.fn() },
}))
vi.mock('@/src/services/crm-opportunity.service', () => ({
  CrmOpportunityService: { list: vi.fn(), update: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-template.service', () => ({
  WhatsAppTemplateService: { list: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-broadcast.service', () => ({
  WhatsAppBroadcastService: { get: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-conversation.service', () => ({
  WhatsAppConversationService: { listWaiting: vi.fn() },
}))

import * as leadImport from '@/app/api/v1/crm/leads/import/route'
import * as leads from '@/app/api/v1/crm/leads/route'
import * as opportunityStage from '@/app/api/v1/crm/opportunities/[opportunityId]/stage/route'
import * as opportunities from '@/app/api/v1/crm/opportunities/route'
import * as pipelines from '@/app/api/v1/crm/pipelines/route'
import * as me from '@/app/api/v1/me/route'
import * as catalog from '@/app/api/v1/servicedesk/catalog/route'
import * as phases from '@/app/api/v1/servicedesk/phases/route'
import * as ticketComments from '@/app/api/v1/servicedesk/tickets/[ticketId]/comments/route'
import * as ticketPhase from '@/app/api/v1/servicedesk/tickets/[ticketId]/phase/route'
import * as ticket from '@/app/api/v1/servicedesk/tickets/[ticketId]/route'
import * as tickets from '@/app/api/v1/servicedesk/tickets/route'
import * as broadcast from '@/app/api/v1/whatsapp/broadcasts/[broadcastId]/route'
import * as waiting from '@/app/api/v1/whatsapp/conversations/waiting/route'
import * as sendTemplate from '@/app/api/v1/whatsapp/messages/template/route'
import * as templates from '@/app/api/v1/whatsapp/templates/route'
import { forbidden } from '@/src/errors'
import { type ApiSession, resolveApiSession } from '@/src/lib/api/session'
import { encodeOffsetCursor } from '@/src/lib/api/v1-pagination'
import { err, ok } from '@/src/lib/result'
import { ApiV1Service } from '@/src/services/api-v1.service'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import { SdCategoryService } from '@/src/services/sd-category.service'
import { SdTicketService } from '@/src/services/sd-ticket.service'
import { SdTicketMessageService } from '@/src/services/sd-ticket-message.service'
import { WhatsAppBroadcastService } from '@/src/services/whatsapp-broadcast.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { WhatsAppTemplateService } from '@/src/services/whatsapp-template.service'

const SESSION: ApiSession = {
  tokenId: 'tok_1',
  userId: 'u1',
  workspaceId: 'ws1',
  scopes: ['api:read', 'api:write'],
  modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
}

type Handler = (
  request: NextRequest,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>

async function call(
  handler: unknown,
  path: string,
  init: { method?: string; body?: unknown; raw?: string } = {},
  params: Record<string, string> = {},
) {
  const request = new Request(`http://localhost/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: 'Bearer stl_pat_x' },
    body:
      init.raw ??
      (init.body === undefined ? undefined : JSON.stringify(init.body)),
  })
  const res = await (handler as Handler)(request as NextRequest, {
    params: Promise.resolve(params),
  })
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveApiSession).mockResolvedValue(ok(SESSION))
})

describe('GET /api/v1/me', () => {
  it('answers ApiV1Service.me for the session', async () => {
    vi.mocked(ApiV1Service.me).mockResolvedValue(ok({ role: 'OWNER' } as never))
    const res = await call(me.GET, '/me')
    expect(ApiV1Service.me).toHaveBeenCalledWith(SESSION)
    expect(res).toEqual({
      status: 200,
      json: { success: true, statusCode: 200, data: { role: 'OWNER' } },
    })
  })
})

describe('ServiceDesk', () => {
  const page = (items: unknown[], nextCursor: string | null) =>
    ok({ items, total: 99, page: 1, pageSize: 25, nextCursor } as never)

  it('lists tickets with the v1 filters mapped onto the app list', async () => {
    vi.mocked(SdTicketService.list).mockResolvedValue(
      page([{ id: 't1' }], 't1'),
    )

    const res = await call(
      tickets.GET,
      '/servicedesk/tickets?status=NEW,RESOLVED&type=INCIDENT&phaseId=p1&priorityId=pr1&assigneeId=me&q=vpn&limit=10&cursor=t0',
    )

    expect(SdTicketService.list).toHaveBeenCalledWith(
      'u1',
      'ws1',
      expect.objectContaining({
        view: 'list',
        types: ['INCIDENT'],
        phaseCategories: ['NEW', 'RESOLVED'],
        phaseIds: ['p1'],
        priorityIds: ['pr1'],
        assigneeIds: ['me'],
        q: 'vpn',
        includeClosed: true,
        pageSize: 10,
        cursor: 't0',
        sort: 'createdAt',
        order: 'desc',
      }),
    )
    // Only items + nextCursor: page/total are not part of v1.
    expect(res.json.data).toEqual({ items: [{ id: 't1' }], nextCursor: 't1' })
  })

  it('lists only open tickets without a status filter', async () => {
    vi.mocked(SdTicketService.list).mockResolvedValue(page([], null))
    await call(tickets.GET, '/servicedesk/tickets?status=NEW')
    expect(vi.mocked(SdTicketService.list).mock.calls[0][2]).toMatchObject({
      includeClosed: false,
      pageSize: 25,
    })
    await call(tickets.GET, '/servicedesk/tickets')
    expect(vi.mocked(SdTicketService.list).mock.calls[1][2]).toMatchObject({
      includeClosed: false,
    })
  })

  it('answers 422 for a ticket cursor that is not an id', async () => {
    const res = await call(
      tickets.GET,
      `/servicedesk/tickets?cursor=${'x'.repeat(65)}`,
    )
    expect(res.status).toBe(422)
    expect(res.json.message).toBe('Cursor inválido')
    expect(SdTicketService.list).not.toHaveBeenCalled()
  })

  it('propagates the list authorization error', async () => {
    vi.mocked(SdTicketService.list).mockResolvedValue(err(forbidden()))
    const res = await call(tickets.GET, '/servicedesk/tickets')
    expect(res.status).toBe(403)
  })

  it('opens a ticket on the API channel unless the body says otherwise', async () => {
    vi.mocked(SdTicketService.create).mockResolvedValue(
      ok({ id: 't1' } as never),
    )

    const created = await call(tickets.POST, '/servicedesk/tickets', {
      method: 'POST',
      body: { type: 'INCIDENT', title: 'VPN fora' },
    })
    expect(created.status).toBe(201)
    expect(SdTicketService.create).toHaveBeenCalledWith(
      'u1',
      'ws1',
      expect.objectContaining({
        type: 'INCIDENT',
        title: 'VPN fora',
        channel: 'API',
      }),
    )

    await call(tickets.POST, '/servicedesk/tickets', {
      method: 'POST',
      body: { type: 'INCIDENT', title: 'Ligação', channel: 'PHONE' },
    })
    expect(vi.mocked(SdTicketService.create).mock.calls[1][2]).toMatchObject({
      channel: 'PHONE',
    })
  })

  it('views a ticket by id, number or code', async () => {
    vi.mocked(SdTicketService.get).mockResolvedValue(ok({ id: 't1' } as never))
    const res = await call(
      ticket.GET,
      '/servicedesk/tickets/INC-000123',
      {},
      {
        ticketId: 'INC-000123',
      },
    )
    expect(SdTicketService.get).toHaveBeenCalledWith('u1', 'ws1', 'INC-000123')
    expect(res.json.data).toEqual({ id: 't1' })
  })

  it('comments without attachments', async () => {
    vi.mocked(SdTicketMessageService.create).mockResolvedValue(
      ok({ id: 'm1' } as never),
    )
    const res = await call(
      ticketComments.POST,
      '/servicedesk/tickets/123/comments',
      {
        method: 'POST',
        body: { body: 'Reiniciei o roteador', visibility: 'INTERNAL' },
      },
      { ticketId: '123' },
    )
    expect(res.status).toBe(201)
    expect(SdTicketMessageService.create).toHaveBeenCalledWith(
      'u1',
      'ws1',
      '123',
      {
        body: 'Reiniciei o roteador',
        visibility: 'INTERNAL',
        attachmentIds: [],
      },
    )
  })

  it('moves a ticket to another phase', async () => {
    vi.mocked(SdTicketService.movePhase).mockResolvedValue(
      ok({ id: 't1' } as never),
    )
    const res = await call(
      ticketPhase.POST,
      '/servicedesk/tickets/t1/phase',
      { method: 'POST', body: { phaseId: 'ph2', comment: 'Resolvido' } },
      { ticketId: 't1' },
    )
    expect(res.status).toBe(200)
    expect(SdTicketService.movePhase).toHaveBeenCalledWith('u1', 'ws1', 't1', {
      phaseId: 'ph2',
      comment: 'Resolvido',
    })
  })

  it('pages the catalog of the ticket type', async () => {
    vi.mocked(SdCategoryService.list).mockResolvedValue(
      ok([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] as never),
    )
    const res = await call(
      catalog.GET,
      '/servicedesk/catalog?ticketType=INCIDENT&limit=2',
    )
    expect(SdCategoryService.list).toHaveBeenCalledWith('u1', 'ws1', {
      ticketType: 'INCIDENT',
      includeInactive: false,
    })
    expect(res.json.data).toEqual({
      items: [{ id: 'c1' }, { id: 'c2' }],
      nextCursor: encodeOffsetCursor(2),
    })
  })

  it('propagates the catalog error', async () => {
    vi.mocked(SdCategoryService.list).mockResolvedValue(err(forbidden()))
    expect((await call(catalog.GET, '/servicedesk/catalog')).status).toBe(403)
  })

  it('pages the phases of a ticket type', async () => {
    vi.mocked(ApiV1Service.listSdPhases).mockResolvedValue(
      ok([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as never),
    )
    const res = await call(
      phases.GET,
      '/servicedesk/phases?ticketType=CHANGE&limit=2',
    )
    expect(ApiV1Service.listSdPhases).toHaveBeenCalledWith(
      'u1',
      'ws1',
      'CHANGE',
    )
    expect(res.json.data).toEqual({
      items: [{ id: 'p1' }, { id: 'p2' }],
      nextCursor: encodeOffsetCursor(2),
    })
  })

  it('lists the phases of every type and refuses an unknown one', async () => {
    vi.mocked(ApiV1Service.listSdPhases).mockResolvedValue(ok([] as never))
    const all = await call(phases.GET, '/servicedesk/phases')
    expect(ApiV1Service.listSdPhases).toHaveBeenCalledWith(
      'u1',
      'ws1',
      undefined,
    )
    expect(all.json.data).toEqual({ items: [], nextCursor: null })

    const invalid = await call(phases.GET, '/servicedesk/phases?ticketType=BUG')
    expect(invalid.status).toBe(422)
  })

  it('propagates the phases error', async () => {
    vi.mocked(ApiV1Service.listSdPhases).mockResolvedValue(err(forbidden()))
    expect((await call(phases.GET, '/servicedesk/phases')).status).toBe(403)
  })
})

describe('CRM', () => {
  it('pages the leads of a stage', async () => {
    vi.mocked(CrmLeadService.list).mockResolvedValue(
      ok([{ id: 'l1' }, { id: 'l2' }] as never),
    )
    const res = await call(
      leads.GET,
      `/crm/leads?stage=RECEIVED&limit=1&cursor=${encodeOffsetCursor(1)}`,
    )
    expect(CrmLeadService.list).toHaveBeenCalledWith('u1', 'ws1', {
      stage: 'RECEIVED',
    })
    expect(res.json.data).toEqual({ items: [{ id: 'l2' }], nextCursor: null })
  })

  it('answers 422 for a cursor it did not issue, and propagates errors', async () => {
    vi.mocked(CrmLeadService.list).mockResolvedValue(ok([] as never))
    expect((await call(leads.GET, '/crm/leads?cursor=nope')).status).toBe(422)
    vi.mocked(CrmLeadService.list).mockResolvedValue(err(forbidden()))
    expect((await call(leads.GET, '/crm/leads')).status).toBe(403)
  })

  it('creates a lead', async () => {
    vi.mocked(CrmLeadService.create).mockResolvedValue(
      ok({ id: 'l1' } as never),
    )
    const res = await call(leads.POST, '/crm/leads', {
      method: 'POST',
      body: { name: 'Carlos', emails: ['c@x.com'], source: 'Site' },
    })
    expect(res.status).toBe(201)
    expect(CrmLeadService.create).toHaveBeenCalledWith(
      'u1',
      'ws1',
      expect.objectContaining({
        name: 'Carlos',
        emails: ['c@x.com'],
        source: 'Site',
      }),
    )
  })

  it('imports a CSV body with the default source of the query', async () => {
    vi.mocked(ApiV1Service.importLeads).mockResolvedValue(
      ok({ total: 1, created: 1, skipped: 0, errors: [] }),
    )
    const res = await call(leadImport.POST, '/crm/leads/import?source=Feira', {
      method: 'POST',
      raw: 'name,email\nAna,a@x.com',
    })
    expect(res.status).toBe(200)
    expect(ApiV1Service.importLeads).toHaveBeenCalledWith(
      'u1',
      'ws1',
      'name,email\nAna,a@x.com',
      'Feira',
    )
  })

  it('pages opportunities by pipeline and stage', async () => {
    vi.mocked(CrmOpportunityService.list).mockResolvedValue(
      ok([{ id: 'o1' }] as never),
    )
    const res = await call(
      opportunities.GET,
      '/crm/opportunities?pipelineId=p1&stageId=s1',
    )
    expect(CrmOpportunityService.list).toHaveBeenCalledWith('u1', 'ws1', {
      pipelineId: 'p1',
      stageId: 's1',
    })
    expect(res.json.data).toEqual({ items: [{ id: 'o1' }], nextCursor: null })
    vi.mocked(CrmOpportunityService.list).mockResolvedValue(err(forbidden()))
    expect((await call(opportunities.GET, '/crm/opportunities')).status).toBe(
      403,
    )
  })

  it('moves an opportunity through the app update with only the stage', async () => {
    vi.mocked(CrmOpportunityService.update).mockResolvedValue(
      ok({ id: 'o1' } as never),
    )
    await call(
      opportunityStage.POST,
      '/crm/opportunities/o1/stage',
      { method: 'POST', body: { stageId: 's2' } },
      { opportunityId: 'o1' },
    )
    expect(CrmOpportunityService.update).toHaveBeenCalledWith(
      'u1',
      'ws1',
      'o1',
      {
        stageId: 's2',
        pipelineId: undefined,
      },
    )
  })

  it('pages the pipelines with their stages', async () => {
    vi.mocked(ApiV1Service.listPipelines).mockResolvedValue(
      ok([{ id: 'p1', stages: [] }] as never),
    )
    const res = await call(pipelines.GET, '/crm/pipelines')
    expect(ApiV1Service.listPipelines).toHaveBeenCalledWith('u1', 'ws1')
    expect(res.json.data).toEqual({
      items: [{ id: 'p1', stages: [] }],
      nextCursor: null,
    })
    vi.mocked(ApiV1Service.listPipelines).mockResolvedValue(err(forbidden()))
    expect((await call(pipelines.GET, '/crm/pipelines')).status).toBe(403)
  })
})

describe('Comunicação', () => {
  const list = [
    { id: 't1', status: 'APPROVED', connectionId: 'c1' },
    { id: 't2', status: 'PENDING', connectionId: 'c1' },
    { id: 't3', status: 'APPROVED', connectionId: 'c2' },
  ]

  it('lists approved templates by default, filtered by connection', async () => {
    vi.mocked(WhatsAppTemplateService.list).mockResolvedValue(ok(list as never))

    const approved = await call(templates.GET, '/whatsapp/templates')
    expect(approved.json.data.items.map((t: { id: string }) => t.id)).toEqual([
      't1',
      't3',
    ])

    const byConnection = await call(
      templates.GET,
      '/whatsapp/templates?connectionId=c1&status=ALL',
    )
    expect(
      byConnection.json.data.items.map((t: { id: string }) => t.id),
    ).toEqual(['t1', 't2'])

    expect(WhatsAppTemplateService.list).toHaveBeenCalledWith('u1', 'ws1')
  })

  it('propagates the template list error', async () => {
    vi.mocked(WhatsAppTemplateService.list).mockResolvedValue(err(forbidden()))
    expect((await call(templates.GET, '/whatsapp/templates')).status).toBe(403)
  })

  it('sends a template', async () => {
    vi.mocked(ApiV1Service.sendWhatsAppTemplate).mockResolvedValue(
      ok({ id: 'm1' } as never),
    )
    const body = {
      conversationId: 'cv1',
      templateName: 'oi',
      language: 'pt_BR',
    }
    const res = await call(sendTemplate.POST, '/whatsapp/messages/template', {
      method: 'POST',
      body,
    })
    expect(res.status).toBe(201)
    expect(ApiV1Service.sendWhatsAppTemplate).toHaveBeenCalledWith(
      'u1',
      'ws1',
      body,
    )
  })

  it('pages the waiting conversations, filtered by connection and team', async () => {
    vi.mocked(WhatsAppConversationService.listWaiting).mockResolvedValue(
      ok([{ id: 'c1' }, { id: 'c2' }] as never),
    )
    const res = await call(
      waiting.GET,
      '/whatsapp/conversations/waiting?connectionId=cn1&teamId=t1&limit=1',
    )
    expect(WhatsAppConversationService.listWaiting).toHaveBeenCalledWith(
      'u1',
      'ws1',
      { connectionId: 'cn1', teamId: 't1' },
    )
    expect(res.json.data).toEqual({
      items: [{ id: 'c1' }],
      nextCursor: encodeOffsetCursor(1),
    })
  })

  it('propagates the waiting list error', async () => {
    vi.mocked(WhatsAppConversationService.listWaiting).mockResolvedValue(
      err(forbidden()),
    )
    expect(
      (await call(waiting.GET, '/whatsapp/conversations/waiting')).status,
    ).toBe(403)
  })

  it('shows a broadcast', async () => {
    vi.mocked(WhatsAppBroadcastService.get).mockResolvedValue(
      ok({ id: 'b1' } as never),
    )
    const res = await call(
      broadcast.GET,
      '/whatsapp/broadcasts/b1',
      {},
      { broadcastId: 'b1' },
    )
    expect(WhatsAppBroadcastService.get).toHaveBeenCalledWith('u1', 'ws1', 'b1')
    expect(res.json.data).toEqual({ id: 'b1' })
  })
})
