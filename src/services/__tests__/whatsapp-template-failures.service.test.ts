import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { AppError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
  whatsAppAdminIds: vi.fn(async () => ['owner', 'admin']),
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/src/lib/whatsapp/meta-templates', () => ({
  fetchMetaTemplates: vi.fn(),
  createMetaTemplate: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import {
  createMetaTemplate,
  fetchMetaTemplates,
} from '@/src/lib/whatsapp/meta-templates'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { notifyWhatsAppUsers } from '../whatsapp-notify'
import { WhatsAppTemplateService } from '../whatsapp-template.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedTemplateRepo = vi.mocked(WhatsAppTemplateRepository)
const mockedFetch = vi.mocked(fetchMetaTemplates)
const mockedCreate = vi.mocked(createMetaTemplate)

const DB_ERROR: AppError = { code: 'DATABASE_ERROR', message: 'db down' }

function asAdmin() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
}

function asNonMember() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
}

function arrangeMeta() {
  asAdmin()
  mockedConnectionRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'META',
        metaWabaId: 'waba-1',
        encryptedMetaAccessToken: 'enc:access-token',
      }),
    ),
  )
  mockedTemplateRepo.upsertSynced.mockResolvedValue(
    ok(createFakeWhatsAppTemplate({ id: 't1' })),
  )
}

const metaItem = (name: string, status: string) =>
  ({
    name,
    language: 'pt_BR',
    category: 'MARKETING',
    status,
    components: [],
  }) as never

describe('WhatsAppTemplateService.list()', () => {
  it('should map the workspace templates', async () => {
    asAdmin()
    mockedTemplateRepo.listByWorkspace.mockResolvedValue(
      ok([createFakeWhatsAppTemplate({ id: 't1', name: 'boas_vindas' })]),
    )

    const templates = expectOk(await WhatsAppTemplateService.list('u1', 'ws1'))

    expect(templates.map((t) => t.name)).toEqual(['boas_vindas'])
  })

  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(await WhatsAppTemplateService.list('u1', 'ws1'), 'FORBIDDEN')
  })

  it('should propagate a repository failure', async () => {
    asAdmin()
    mockedTemplateRepo.listByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(await WhatsAppTemplateService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('WhatsAppTemplateService.sync() failures', () => {
  const sync = () => WhatsAppTemplateService.sync('u1', 'ws1', 'conn1')

  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(await sync(), 'FORBIDDEN')
  })

  it('should propagate a connection lookup failure', async () => {
    arrangeMeta()
    mockedConnectionRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await sync(), 'DATABASE_ERROR')
  })

  it.each([
    [new Error('token expired'), 'token expired'],
    ['boom', 'Falha ao sincronizar templates'],
  ])(
    'should map a Meta failure (%s) to BAD_REQUEST',
    async (thrown, message) => {
      arrangeMeta()
      mockedFetch.mockRejectedValue(thrown)

      const error = expectErr(await sync(), 'BAD_REQUEST')
      expect(error.message).toBe(message)
    },
  )

  it('should default unknown statuses to PENDING and skip rows that fail to save', async () => {
    arrangeMeta()
    mockedFetch.mockResolvedValue([
      metaItem('em_revisao', 'IN_APPEAL'),
      metaItem('quebrado', 'APPROVED'),
    ])
    mockedTemplateRepo.upsertSynced
      .mockResolvedValueOnce(ok(createFakeWhatsAppTemplate({ id: 't1' })))
      .mockResolvedValueOnce(err(DB_ERROR))

    const synced = expectOk(await sync())

    expect(synced.map((t) => t.id)).toEqual(['t1'])
    expect(mockedTemplateRepo.upsertSynced).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'em_revisao', status: 'PENDING' }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sync', meta: { count: 1 } }),
    )
  })
})

describe('WhatsAppTemplateService.create() failures and components', () => {
  const input = {
    connectionId: 'conn1',
    name: 'promo_setembro',
    language: 'pt_BR',
    category: 'MARKETING' as const,
    body: 'Olá! Temos novidades.',
  }

  it('should propagate a connection lookup failure', async () => {
    arrangeMeta()
    mockedConnectionRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppTemplateService.create('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
  })

  it('should return WHATSAPP_CONNECTION_NOT_FOUND for an unknown connection', async () => {
    arrangeMeta()
    mockedConnectionRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppTemplateService.create('u1', 'ws1', input),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })

  it('should submit header, footer and buttons alongside the body', async () => {
    arrangeMeta()
    mockedCreate.mockResolvedValue(metaItem('promo_setembro', 'APPROVED'))
    const buttons = [{ type: 'QUICK_REPLY' as const, text: 'Quero saber' }]
    const inputButtons = [
      { id: 'b1', type: 'REPLY' as const, label: 'Quero saber', actions: [] },
    ]

    expectOk(
      await WhatsAppTemplateService.create('u1', 'ws1', {
        ...input,
        headerText: 'Promoção',
        footer: 'Responda SAIR para não receber',
        buttons: inputButtons,
      }),
    )

    const components = [
      { type: 'HEADER', format: 'TEXT', text: 'Promoção' },
      { type: 'BODY', text: 'Olá! Temos novidades.' },
      { type: 'FOOTER', text: 'Responda SAIR para não receber' },
      { type: 'BUTTONS', buttons },
    ]
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ components }),
    )
    expect(mockedTemplateRepo.upsertSynced).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED', components }),
    )
  })

  it('should omit the buttons block for an empty button list and default unknown statuses to PENDING', async () => {
    arrangeMeta()
    mockedCreate.mockResolvedValue(metaItem('promo_setembro', 'PAUSED'))

    expectOk(
      await WhatsAppTemplateService.create('u1', 'ws1', {
        ...input,
        buttons: [],
      }),
    )

    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [{ type: 'BODY', text: 'Olá! Temos novidades.' }],
      }),
    )
    expect(mockedTemplateRepo.upsertSynced).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING' }),
    )
  })

  it('should use a generic message for a non-Error Meta failure', async () => {
    arrangeMeta()
    mockedCreate.mockRejectedValue('boom')

    const error = expectErr(
      await WhatsAppTemplateService.create('u1', 'ws1', input),
      'BAD_REQUEST',
    )
    expect(error.message).toBe('Falha ao criar template')
  })

  it('should propagate a failure persisting the created template', async () => {
    arrangeMeta()
    mockedCreate.mockResolvedValue(metaItem('promo_setembro', 'PENDING'))
    mockedTemplateRepo.upsertSynced.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppTemplateService.create('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })
})

describe('WhatsAppTemplateService.sync() · rejection notice', () => {
  const notify = vi.mocked(notifyWhatsAppUsers)
  const sync = () => WhatsAppTemplateService.sync('u1', 'ws1', 'conn1')
  const known = (name: string, status: 'PENDING' | 'APPROVED' | 'REJECTED') =>
    createFakeWhatsAppTemplate({
      connectionId: 'conn1',
      name,
      language: 'pt_BR',
      status,
    })

  function arrange(
    before: ReturnType<typeof known>[],
    fetched: [string, string][],
  ) {
    arrangeMeta()
    mockedTemplateRepo.listByWorkspace.mockResolvedValue(ok(before))
    mockedFetch.mockResolvedValue(
      fetched.map(([name, status]) => metaItem(name, status)),
    )
    mockedTemplateRepo.upsertSynced.mockImplementation(async (data) =>
      ok(createFakeWhatsAppTemplate({ ...data, components: [] })),
    )
  }

  it('tells the admins (not the actor) about templates that became REJECTED', async () => {
    arrange(
      [
        known('promo', 'PENDING'),
        known('aviso', 'APPROVED'),
        known('velho', 'REJECTED'),
        createFakeWhatsAppTemplate({
          connectionId: 'other-conn',
          name: 'outra',
          language: 'pt_BR',
          status: 'PENDING',
        }),
      ],
      [
        ['promo', 'REJECTED'],
        ['aviso', 'REJECTED'],
        ['velho', 'REJECTED'],
        ['outra', 'REJECTED'],
        ['novo', 'REJECTED'],
      ],
    )

    expectOk(await sync())

    expect(notify).toHaveBeenCalledTimes(1)
    const [input] = notify.mock.calls[0]
    expect(input).toMatchObject({
      workspaceId: 'ws1',
      kind: 'WHATSAPP_TEMPLATE_REJECTED',
      userIds: ['owner', 'admin'],
      actorId: 'u1',
      title: '2 templates reprovados pela Meta',
      body: 'Reprovado(s): promo (pt_BR), aviso (pt_BR).',
    })
    expect(input.path).toBe('/zap/templates')
  })

  it('uses the singular title for one template', async () => {
    arrange([known('promo', 'PENDING')], [['promo', 'REJECTED']])
    expectOk(await sync())
    expect(notify.mock.calls[0][0].title).toBe('Template reprovado pela Meta')
  })

  it('stays quiet when nothing changed to REJECTED', async () => {
    arrange([known('promo', 'PENDING')], [['promo', 'APPROVED']])
    expectOk(await sync())
    expect(notify).not.toHaveBeenCalled()
  })

  it('still syncs when the previous statuses cannot be read', async () => {
    arrange([], [['promo', 'REJECTED']])
    mockedTemplateRepo.listByWorkspace.mockResolvedValue(err(DB_ERROR))
    expect(expectOk(await sync())).toHaveLength(1)
    expect(notify).not.toHaveBeenCalled()
  })
})
