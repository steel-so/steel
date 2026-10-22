import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  forbidden,
  whatsappBroadcastNoRecipients,
  whatsappQuickReplyNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/whatsapp-quick-reply.service')
vi.mock('@/src/services/whatsapp-broadcast.service')
vi.mock('@/src/services/whatsapp-connection.service')
vi.mock('@/src/services/whatsapp-contact.service')
vi.mock('@/src/services/whatsapp-group.service')
vi.mock('@/src/services/whatsapp-template.service')
vi.mock('@/src/services/whatsapp-conversation.service')
vi.mock('@/src/repositories/workspace.repository')

import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WhatsAppBroadcastService } from '@/src/services/whatsapp-broadcast.service'
import { WhatsAppConnectionService } from '@/src/services/whatsapp-connection.service'
import { WhatsAppContactService } from '@/src/services/whatsapp-contact.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { WhatsAppGroupService } from '@/src/services/whatsapp-group.service'
import { WhatsAppQuickReplyService } from '@/src/services/whatsapp-quick-reply.service'
import { WhatsAppTemplateService } from '@/src/services/whatsapp-template.service'
import { validateToolRegistry } from '../ai/tools/registry'
import { WHATSAPP_AI_TOOLS } from '../ai/tools/whatsapp'
import {
  zapBroadcastCreateDraftTool,
  zapBroadcastGetTool,
  zapBroadcastsListTool,
} from '../ai/tools/whatsapp/broadcasts'
import {
  zapConnectionsStatusTool,
  zapGroupsListTool,
  zapTemplatesListTool,
} from '../ai/tools/whatsapp/catalog'
import { zapDashboardTool } from '../ai/tools/whatsapp/dashboard'
import {
  zapQuickRepliesListTool,
  zapQuickReplyCreateTool,
  zapQuickReplyDeleteTool,
  zapQuickReplyUpdateTool,
} from '../ai/tools/whatsapp/quick-replies'
import { matches, paginate, truncate } from '../ai/tools/whatsapp/shared'
import {
  broadcast,
  connection,
  contact,
  conversation,
  ctx,
  group,
  members,
  previewOf,
  quickReply,
  template,
  workspace,
} from './zap-ai-fixtures'

const quickReplies = vi.mocked(WhatsAppQuickReplyService)
const broadcasts = vi.mocked(WhatsAppBroadcastService)
const connections = vi.mocked(WhatsAppConnectionService)
const contacts = vi.mocked(WhatsAppContactService)
const groups = vi.mocked(WhatsAppGroupService)
const templates = vi.mocked(WhatsAppTemplateService)
const conversations = vi.mocked(WhatsAppConversationService)
const workspaces = vi.mocked(WorkspaceRepository)

beforeEach(() => {
  vi.resetAllMocks()
  workspaces.findById.mockResolvedValue(ok(workspace))
})

describe('WHATSAPP_AI_TOOLS', () => {
  it('should be a valid registry of zap_ tools in the COMMUNICATION module', () => {
    expect(validateToolRegistry(WHATSAPP_AI_TOOLS)).toEqual([])
    for (const tool of WHATSAPP_AI_TOOLS) {
      expect(tool.name).toMatch(/^zap_/)
      expect(tool.module).toBe('COMMUNICATION')
      if (tool.kind !== 'READ') expect(tool.preview).toBeTypeOf('function')
    }
    expect(WHATSAPP_AI_TOOLS.filter((t) => t.kind === 'ACTION')).toEqual([
      expect.objectContaining({ name: 'zap_message_send_text' }),
    ])
    expect(WHATSAPP_AI_TOOLS).toHaveLength(25)
  })
})

describe('shared helpers', () => {
  it('should paginate, truncate and match ignoring case and accents', () => {
    expect(paginate([1, 2, 3], 2, 5)).toEqual({
      total: 3,
      offset: 2,
      limit: 5,
      hasMore: false,
      items: [3],
    })
    expect(truncate(null)).toBeNull()
    expect(truncate('abc', 2)).toBe('ab…')
    expect(matches('Conceição', 'CONCEICAO')).toBe(true)
    expect(matches(null, 'x')).toBe(false)
  })
})

/* ------------------------------ quick replies ----------------------------- */

describe('zap_quick_replies_list', () => {
  it('should search shortcut, title and body and paginate', async () => {
    quickReplies.list.mockResolvedValue(
      ok([
        quickReply({ id: 'a', shortcut: 'pix' }),
        quickReply({ id: 'b', title: 'Endereço' }),
        quickReply({ id: 'c', body: 'Nosso horário é 9h–18h', mediaUrl: 'x' }),
        quickReply({ id: 'd' }),
      ]),
    )
    const run = async (args: Record<string, unknown>) =>
      expectOk(
        await zapQuickRepliesListTool.execute(
          ctx,
          expectOk(zapQuickRepliesListTool.parse(args)),
        ),
      )
    const pix = await run({ query: 'PIX' })
    expect((pix.data as { total: number }).total).toBe(1)
    expect((await run({ query: 'endereco' })).summary).toBe(
      '1 mensagem(ns) rápida(s)',
    )
    const horario = await run({ query: 'horário' })
    expect((horario.data as { items: unknown[] }).items[0]).toMatchObject({
      id: 'c',
      hasMedia: true,
    })
    const all = await run({})
    expect(all.data).toMatchObject({
      total: 4,
      href: '/acme/zap/mensagens-rapidas',
    })
  })

  it('should propagate errors', async () => {
    const args = expectOk(zapQuickRepliesListTool.parse({}))
    quickReplies.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(await zapQuickRepliesListTool.execute(ctx, args), 'FORBIDDEN')
    quickReplies.list.mockResolvedValue(ok([]))
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await zapQuickRepliesListTool.execute(ctx, args),
      'DATABASE_ERROR',
    )
  })
})

describe('zap_quick_reply_create', () => {
  const tool = zapQuickReplyCreateTool
  const args = { shortcut: 'pix', title: 'Chave PIX', body: 'Chave: 123' }

  it('should validate, preview and create', async () => {
    expectErr(tool.parse({ shortcut: 'x' }), 'VALIDATION_ERROR')
    const preview = expectOk(await previewOf(tool)(ctx, args))
    expect(preview).toEqual({
      title: 'Criar a mensagem rápida “Chave PIX”',
      summary: 'Atalho /pix.',
      fields: [
        { label: 'Atalho', after: 'pix' },
        { label: 'Título', after: 'Chave PIX' },
        { label: 'Texto', after: 'Chave: 123' },
      ],
      target: {
        type: 'whatsapp_quick_reply',
        label: 'Chave PIX',
        href: '/acme/zap/mensagens-rapidas',
      },
    })
    quickReplies.create.mockResolvedValue(ok(quickReply({ id: 'q9', ...args })))
    const out = expectOk(await tool.execute(ctx, args))
    expect(quickReplies.create).toHaveBeenCalledWith('u1', 'ws1', args)
    expect(out.target?.id).toBe('q9')
  })

  it('should propagate errors', async () => {
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await previewOf(tool)(ctx, args), 'DATABASE_ERROR')
    quickReplies.create.mockResolvedValueOnce(err(forbidden()))
    expectErr(await tool.execute(ctx, args), 'FORBIDDEN')
    quickReplies.create.mockResolvedValue(ok(quickReply()))
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await tool.execute(ctx, args), 'DATABASE_ERROR')
  })
})

describe('zap_quick_reply_update', () => {
  const tool = zapQuickReplyUpdateTool

  it('should require a change and preview each changed field', async () => {
    expectErr(tool.parse({ quickReplyId: 'q1' }), 'VALIDATION_ERROR')
    quickReplies.list.mockResolvedValue(ok([quickReply()]))
    const preview = expectOk(
      await previewOf(tool)(ctx, {
        quickReplyId: 'q1',
        shortcut: 'ola',
        title: 'Oi',
        body: 'Oi!',
      }),
    )
    expect(preview.fields).toEqual([
      { label: 'Atalho', before: 'oi', after: 'ola' },
      { label: 'Título', before: 'Saudação', after: 'Oi' },
      { label: 'Texto', before: 'Olá! Como posso ajudar?', after: 'Oi!' },
    ])
    const one = expectOk(
      await previewOf(tool)(ctx, { quickReplyId: 'q1', body: 'x' }),
    )
    expect(one.summary).toBe('1 campo(s) alterado(s).')
  })

  it('should map not found and list errors', async () => {
    quickReplies.list.mockResolvedValueOnce(ok([]))
    expectErr(
      await previewOf(tool)(ctx, { quickReplyId: 'zz', title: 'x' }),
      whatsappQuickReplyNotFound().code,
    )
    quickReplies.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await previewOf(tool)(ctx, { quickReplyId: 'q1', title: 'x' }),
      'FORBIDDEN',
    )
    quickReplies.list.mockResolvedValueOnce(ok([quickReply()]))
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await previewOf(tool)(ctx, { quickReplyId: 'q1', title: 'x' }),
      'DATABASE_ERROR',
    )
  })

  it('should update only the given fields', async () => {
    quickReplies.update.mockResolvedValue(ok(quickReply({ title: 'Oi' })))
    const out = expectOk(
      await tool.execute(ctx, { quickReplyId: 'q1', title: 'Oi' }),
    )
    expect(quickReplies.update).toHaveBeenCalledWith('u1', 'ws1', 'q1', {
      title: 'Oi',
    })
    expect(out.summary).toBe('Mensagem rápida “Oi” atualizada')
    quickReplies.update.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await tool.execute(ctx, { quickReplyId: 'q1', title: 'x' }),
      'FORBIDDEN',
    )
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await tool.execute(ctx, { quickReplyId: 'q1', title: 'x' }),
      'DATABASE_ERROR',
    )
  })
})

describe('zap_quick_reply_delete', () => {
  const tool = zapQuickReplyDeleteTool

  it('should preview and delete', async () => {
    expect(tool.kind).toBe('DELETE')
    quickReplies.list.mockResolvedValue(ok([quickReply()]))
    const preview = expectOk(await previewOf(tool)(ctx, { quickReplyId: 'q1' }))
    expect(preview.summary).toMatch(/\/oi deixa de existir/)
    quickReplies.remove.mockResolvedValue(ok(undefined))
    const out = expectOk(await tool.execute(ctx, { quickReplyId: 'q1' }))
    expect(quickReplies.remove).toHaveBeenCalledWith('u1', 'ws1', 'q1')
    expect(out.data).toEqual({ id: 'q1', deleted: true })
  })

  it('should propagate errors', async () => {
    expectErr(tool.parse({}), 'VALIDATION_ERROR')
    quickReplies.list.mockResolvedValueOnce(ok([]))
    expectErr(
      await previewOf(tool)(ctx, { quickReplyId: 'q1' }),
      'WHATSAPP_QUICK_REPLY_NOT_FOUND',
    )
    quickReplies.list.mockResolvedValueOnce(ok([]))
    expectErr(
      await tool.execute(ctx, { quickReplyId: 'q1' }),
      'WHATSAPP_QUICK_REPLY_NOT_FOUND',
    )
    quickReplies.list.mockResolvedValue(ok([quickReply()]))
    quickReplies.remove.mockResolvedValueOnce(err(forbidden()))
    expectErr(await tool.execute(ctx, { quickReplyId: 'q1' }), 'FORBIDDEN')
  })
})

/* -------------------------------- broadcasts ------------------------------ */

describe('zap_broadcasts_list', () => {
  it('should filter by status and name and expose delivery stats', async () => {
    broadcasts.list.mockResolvedValue(
      ok([
        broadcast({ id: 'a', status: 'DONE' }),
        broadcast({ id: 'b', name: 'Black Friday', status: 'DRAFT' }),
        broadcast({
          id: 'c',
          recipientCount: 1,
          sentCount: 2,
          failedCount: 0,
          skippedCount: 0,
        }),
      ]),
    )
    const out = expectOk(
      await zapBroadcastsListTool.execute(
        ctx,
        expectOk(zapBroadcastsListTool.parse({ status: 'DONE' })),
      ),
    )
    const data = out.data as { items: Record<string, unknown>[] }
    expect(data.items).toHaveLength(1)
    expect(data.items[0].stats).toEqual({
      recipients: 10,
      sent: 6,
      failed: 1,
      skippedOptOut: 1,
      skippedNoWhatsapp: 0,
      pending: 2,
    })
    const byName = expectOk(
      await zapBroadcastsListTool.execute(
        ctx,
        expectOk(zapBroadcastsListTool.parse({ query: 'black' })),
      ),
    )
    expect(byName.summary).toBe('1 transmissão(ões) encontrada(s)')
    const all = expectOk(
      await zapBroadcastsListTool.execute(
        ctx,
        expectOk(zapBroadcastsListTool.parse({})),
      ),
    )
    const items = (all.data as { items: { stats: { pending: number } }[] })
      .items
    expect(items[2].stats.pending).toBe(0)
    expectErr(
      zapBroadcastsListTool.parse({ status: 'SENT' }),
      'VALIDATION_ERROR',
    )
  })

  it('should propagate errors', async () => {
    const args = expectOk(zapBroadcastsListTool.parse({}))
    broadcasts.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(await zapBroadcastsListTool.execute(ctx, args), 'FORBIDDEN')
    broadcasts.list.mockResolvedValue(ok([]))
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await zapBroadcastsListTool.execute(ctx, args), 'DATABASE_ERROR')
  })
})

describe('zap_broadcast_get', () => {
  it('should return stats and failed recipients', async () => {
    broadcasts.get.mockResolvedValue(
      ok(
        broadcast({
          recipients: [
            {
              id: 'r1',
              contactId: 'ct1',
              contactName: null,
              contactWaId: '5511',
              contactHasWhatsapp: null,
              status: 'FAILED',
              errorMessage: 'Número inválido',
              sentAt: null,
            },
            {
              id: 'r2',
              contactId: 'ct2',
              contactName: 'João',
              contactWaId: '5512',
              contactHasWhatsapp: null,
              status: 'FAILED',
              errorMessage: null,
              sentAt: null,
            },
            {
              id: 'r3',
              contactId: 'ct3',
              contactName: 'Ana',
              contactWaId: '5513',
              contactHasWhatsapp: null,
              status: 'SENT',
              errorMessage: null,
              sentAt: null,
            },
          ],
        }),
      ),
    )
    const out = expectOk(
      await zapBroadcastGetTool.execute(ctx, { broadcastId: 'b1' }),
    )
    expect(out.data).toMatchObject({
      id: 'b1',
      failures: [
        { contact: '+5511', error: 'Número inválido' },
        { contact: 'João', error: null },
      ],
    })
    expect(out.summary).toBe('Promoção: 6/10 enviada(s), 1 falha(s)')
    expect(out.target).toEqual({
      type: 'whatsapp_broadcast',
      id: 'b1',
      label: 'Promoção',
      href: '/acme/zap/transmissoes',
    })
  })

  it('should propagate errors', async () => {
    expectErr(zapBroadcastGetTool.parse({}), 'VALIDATION_ERROR')
    broadcasts.get.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await zapBroadcastGetTool.execute(ctx, { broadcastId: 'b1' }),
      'FORBIDDEN',
    )
    broadcasts.get.mockResolvedValue(ok(broadcast()))
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await zapBroadcastGetTool.execute(ctx, { broadcastId: 'b1' }),
      'DATABASE_ERROR',
    )
  })
})

describe('zap_broadcast_create_draft', () => {
  const tool = zapBroadcastCreateDraftTool
  const args = {
    connectionId: 'cn1',
    name: 'Promoção',
    messageBody: 'Novidades!',
    contactIds: ['a', 'b', 'c', 'a'],
  }

  beforeEach(() => {
    connections.list.mockResolvedValue(ok([connection()]))
    contacts.list.mockResolvedValue(
      ok([
        contact({ id: 'a' }),
        contact({ id: 'b', broadcastOptedOutAt: '2026-10-01T00:00:00.000Z' }),
      ]),
    )
  })

  it('should cap recipients at 1000', () => {
    expectErr(
      tool.parse({
        ...args,
        contactIds: Array.from({ length: 1001 }, (_, i) => `c${i}`),
      }),
      'VALIDATION_ERROR',
    )
    expectErr(tool.parse({ ...args, contactIds: [] }), 'VALIDATION_ERROR')
  })

  it('should preview a draft with the eligible count and exclusions', async () => {
    const preview = expectOk(await previewOf(tool)(ctx, args))
    expect(preview.fields).toEqual([
      { label: 'Conexão', after: 'Comercial (+55 11 4000-0000)' },
      { label: 'Destinatários', after: '1' },
      { label: 'Mensagem', after: 'Novidades!' },
      { label: 'Status', after: 'Rascunho' },
    ])
    expect(preview.summary).toMatch(/nada é enviado/)
    expect(preview.summary).toMatch(
      /1 descadastrado\(s\) \(LGPD\), 1 não encontrado\(s\)/,
    )
    const clean = expectOk(
      await previewOf(tool)(ctx, { ...args, contactIds: ['a'] }),
    )
    expect(clean.summary).not.toMatch(/Ficam de fora/)
    expect(broadcasts.create).not.toHaveBeenCalled()
  })

  it('should refuse when nobody is eligible or the connection is unknown', async () => {
    expectErr(
      await previewOf(tool)(ctx, { ...args, contactIds: ['b', 'zz'] }),
      whatsappBroadcastNoRecipients().code,
    )
    expectErr(
      await previewOf(tool)(ctx, { ...args, connectionId: 'zz' }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })

  it('should propagate dependency errors in the preview', async () => {
    connections.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(await previewOf(tool)(ctx, args), 'FORBIDDEN')
    contacts.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(await previewOf(tool)(ctx, args), 'FORBIDDEN')
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await previewOf(tool)(ctx, args), 'DATABASE_ERROR')
  })

  it('should create the list through the service (DRAFT, never started)', async () => {
    broadcasts.create.mockResolvedValue(ok(broadcast({ recipientCount: 1 })))
    const out = expectOk(await tool.execute(ctx, args))
    expect(broadcasts.create).toHaveBeenCalledWith('u1', 'ws1', {
      connectionId: 'cn1',
      name: 'Promoção',
      messageBody: 'Novidades!',
      contactIds: ['a', 'b', 'c', 'a'],
    })
    expect(broadcasts.start).not.toHaveBeenCalled()
    expect(out.summary).toBe('Rascunho “Promoção” criado com 1 destinatário(s)')
    expect(out.data).toMatchObject({ status: 'DRAFT' })

    broadcasts.create.mockResolvedValueOnce(
      err(whatsappBroadcastNoRecipients()),
    )
    expectErr(await tool.execute(ctx, args), 'WHATSAPP_BROADCAST_NO_RECIPIENTS')
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await tool.execute(ctx, args), 'DATABASE_ERROR')
  })
})

/* --------------------------------- catalog -------------------------------- */

describe('zap_groups_list', () => {
  it('should list groups with participants and admins', async () => {
    groups.list.mockResolvedValue(
      ok([
        group({
          participants: [
            { waId: '551', name: 'Ana', role: 'ADMIN' },
            { waId: '552', name: null, role: 'ADMIN' },
            { waId: '553', name: 'Leo', role: 'MEMBER' },
          ],
        }),
        group({ id: 'g2', name: 'Fornecedores' }),
      ]),
    )
    const out = expectOk(
      await zapGroupsListTool.execute(
        ctx,
        expectOk(zapGroupsListTool.parse({ query: 'vip', archived: true })),
      ),
    )
    expect(groups.list).toHaveBeenCalledWith('u1', 'ws1', { archived: true })
    expect((out.data as { items: unknown[] }).items).toEqual([
      expect.objectContaining({
        id: 'g1',
        participantCount: 3,
        admins: ['Ana', '+552'],
      }),
    ])
    const all = expectOk(
      await zapGroupsListTool.execute(
        ctx,
        expectOk(zapGroupsListTool.parse({})),
      ),
    )
    expect(all.summary).toBe('2 grupo(s) encontrado(s)')
  })

  it('should propagate errors', async () => {
    const args = expectOk(zapGroupsListTool.parse({}))
    groups.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(await zapGroupsListTool.execute(ctx, args), 'FORBIDDEN')
    groups.list.mockResolvedValue(ok([]))
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await zapGroupsListTool.execute(ctx, args), 'DATABASE_ERROR')
  })
})

describe('zap_templates_list', () => {
  it('should filter by status, connection and name and extract the body', async () => {
    templates.list.mockResolvedValue(
      ok([
        template(),
        template({
          id: 't2',
          name: 'cobranca',
          status: 'REJECTED',
          components: [
            null,
            'x',
            { type: 'HEADER', text: 'h' },
            { type: 'BODY' },
          ],
        }),
        template({ id: 't3', connectionId: 'cn2', status: 'PENDING' }),
      ]),
    )
    const approved = expectOk(
      await zapTemplatesListTool.execute(
        ctx,
        expectOk(zapTemplatesListTool.parse({ status: 'APPROVED' })),
      ),
    )
    expect((approved.data as { items: unknown[] }).items).toEqual([
      expect.objectContaining({ id: 't1', body: 'Olá {{1}}' }),
    ])
    const byName = expectOk(
      await zapTemplatesListTool.execute(
        ctx,
        expectOk(zapTemplatesListTool.parse({ query: 'cobr' })),
      ),
    )
    expect(
      (byName.data as { items: { body: unknown }[] }).items[0].body,
    ).toBeNull()
    const byConnection = expectOk(
      await zapTemplatesListTool.execute(
        ctx,
        expectOk(zapTemplatesListTool.parse({ connectionId: 'cn1' })),
      ),
    )
    expect(byConnection.summary).toBe('2 modelo(s), 1 aprovado(s)')
  })

  it('should propagate errors', async () => {
    const args = expectOk(zapTemplatesListTool.parse({}))
    templates.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(await zapTemplatesListTool.execute(ctx, args), 'FORBIDDEN')
    templates.list.mockResolvedValue(ok([]))
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await zapTemplatesListTool.execute(ctx, args), 'DATABASE_ERROR')
  })
})

describe('zap_connections_status', () => {
  it('should report each connection status', async () => {
    expectErr(zapConnectionsStatusTool.parse({ x: 1 }), 'VALIDATION_ERROR')
    connections.list.mockResolvedValue(
      ok([
        connection(),
        connection({
          id: 'cn2',
          provider: 'META',
          status: 'ERROR',
          statusError: 'Token expirado',
        }),
      ]),
    )
    const out = expectOk(await zapConnectionsStatusTool.execute(ctx, {}))
    expect(out.summary).toBe('1 de 2 conexão(ões) conectada(s)')
    expect(out.data).toMatchObject({
      href: '/acme/zap/configuracoes',
      items: [
        { id: 'cn1', statusLabel: 'Conectada' },
        { id: 'cn2', statusLabel: 'Com erro', error: 'Token expirado' },
      ],
    })
  })

  it('should propagate errors', async () => {
    connections.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(await zapConnectionsStatusTool.execute(ctx, {}), 'FORBIDDEN')
    connections.list.mockResolvedValue(ok([]))
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await zapConnectionsStatusTool.execute(ctx, {}), 'DATABASE_ERROR')
  })
})

/* -------------------------------- dashboard ------------------------------- */

describe('zap_dashboard', () => {
  const NOW = new Date('2026-10-06T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    conversations.listAssignableMembers.mockResolvedValue(ok(members))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should count open work, agents and recently closed conversations', async () => {
    conversations.list.mockImplementation(async (_a, _w, filters) =>
      filters?.status === 'OPEN'
        ? ok([
            conversation({ status: 'NEW', unreadCount: 2 }),
            conversation({ assignedUserId: 'u1', aiActive: true }),
            conversation({ assignedUserId: 'u1', avgSentimentScore: -0.6 }),
            conversation({ assignedUserId: 'u2', avgSentimentScore: 0.2 }),
            conversation({ assignedUserId: 'gone' }),
          ])
        : ok([
            conversation({
              status: 'CLOSED',
              closedAt: '2026-10-05T00:00:00.000Z',
            }),
            conversation({
              status: 'CLOSED',
              closedAt: '2026-09-01T00:00:00.000Z',
            }),
            conversation({ status: 'CLOSED', closedAt: null }),
          ]),
    )
    const args = expectOk(zapDashboardTool.parse({ connectionId: 'cn1' }))
    expect(args.closedWindowDays).toBe(7)
    const out = expectOk(await zapDashboardTool.execute(ctx, args))
    expect(conversations.list).toHaveBeenCalledWith('u1', 'ws1', {
      connectionId: 'cn1',
      status: 'OPEN',
    })
    expect(out.data).toMatchObject({
      open: 5,
      new: 1,
      inProgress: 4,
      assigned: 4,
      unassigned: 1,
      unread: 1,
      handledByAi: 1,
      negativeSentiment: 1,
      closedRecently: 1,
      avgFirstResponseMinutes: null,
      href: '/acme/zap',
      byAgent: [
        { userId: 'u1', name: 'Ana', open: 2 },
        { userId: 'u2', name: 'Bruno', open: 1 },
        { userId: 'gone', name: 'Membro removido', open: 1 },
      ],
    })
    expect(out.summary).toBe('5 aberta(s): 1 sem responsável, 1 não lida(s)')
    expectErr(
      zapDashboardTool.parse({ closedWindowDays: 91 }),
      'VALIDATION_ERROR',
    )
  })

  it('should propagate each dependency error', async () => {
    const args = expectOk(zapDashboardTool.parse({}))
    conversations.list.mockResolvedValueOnce(err(forbidden()))
    conversations.list.mockResolvedValueOnce(ok([]))
    expectErr(await zapDashboardTool.execute(ctx, args), 'FORBIDDEN')

    conversations.list.mockResolvedValueOnce(ok([]))
    conversations.list.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await zapDashboardTool.execute(ctx, args), 'DATABASE_ERROR')

    conversations.list.mockResolvedValue(ok([]))
    conversations.listAssignableMembers.mockResolvedValueOnce(err(forbidden()))
    expectErr(await zapDashboardTool.execute(ctx, args), 'FORBIDDEN')

    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await zapDashboardTool.execute(ctx, args), 'DATABASE_ERROR')
  })
})
