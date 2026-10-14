import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, validationError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/env/server', () => ({ WHATSAPP_META_APP_ID: '777' }))
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
  uploadMetaTemplateMedia: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/media', () => ({ readWorkspaceMedia: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { readWorkspaceMedia } from '@/src/lib/whatsapp/media'
import {
  createMetaTemplate,
  fetchMetaTemplates,
  uploadMetaTemplateMedia,
} from '@/src/lib/whatsapp/meta-templates'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { notifyWhatsAppUsers } from '../whatsapp-notify'
import { WhatsAppTemplateService } from '../whatsapp-template.service'

const membershipRepo = vi.mocked(MembershipRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const fetchTemplates = vi.mocked(fetchMetaTemplates)
const createTemplate = vi.mocked(createMetaTemplate)
const upload = vi.mocked(uploadMetaTemplateMedia)
const readMedia = vi.mocked(readWorkspaceMedia)
const notify = vi.mocked(notifyWhatsAppUsers)

const metaConnection = createFakeWhatsAppConnection({
  id: 'conn1',
  workspaceId: 'ws1',
  provider: 'META',
  module: 'COMMUNICATION',
  metaWabaId: 'waba-1',
  encryptedMetaAccessToken: 'enc:tok',
})

function as(role: 'ADMIN' | 'MEMBER' | null) {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(role ? createFakeMembership({ role }) : null),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  as('ADMIN')
  connectionRepo.findById.mockResolvedValue(ok(metaConnection))
  templateRepo.upsertSynced.mockImplementation(async (data) =>
    ok(createFakeWhatsAppTemplate({ ...data, buttons: null } as never)),
  )
  templateRepo.update.mockImplementation(async (id, data) =>
    ok(createFakeWhatsAppTemplate({ id, ...(data as object) } as never)),
  )
})

const metaButtons = {
  type: 'BUTTONS',
  buttons: [
    { type: 'QUICK_REPLY', text: 'Sim' },
    { type: 'URL', text: 'Site', url: 'https://steel.app' },
  ],
}

describe('create() with media header and buttons', () => {
  const input = {
    connectionId: 'conn1',
    name: 'promo',
    language: 'pt_BR',
    category: 'MARKETING' as const,
    headerFormat: 'IMAGE' as const,
    headerMediaUrl: 'https://media/whatsapp-media/ws1/a.png',
    body: 'Oferta!',
    buttons: [
      {
        id: 'yes',
        type: 'REPLY' as const,
        label: 'Sim',
        actions: [{ kind: 'REPLY' as const, text: 'Ótimo!' }],
      },
    ],
  }

  it('uploads the sample to Meta and saves our copy and the buttons', async () => {
    readMedia.mockResolvedValue(
      ok({
        body: Buffer.from('x'),
        contentType: 'image/png',
        fileName: 'a.png',
      }),
    )
    upload.mockResolvedValue('4::handle')
    createTemplate.mockResolvedValue({
      name: 'promo',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'PENDING',
      components: [],
    })

    const dto = expectOk(
      await WhatsAppTemplateService.create('u1', 'ws1', input),
    )

    expect(readMedia).toHaveBeenCalledWith('ws1', input.headerMediaUrl)
    expect(upload).toHaveBeenCalledWith({
      accessToken: 'tok',
      appId: '777',
      body: Buffer.from('x'),
      contentType: 'image/png',
      fileName: 'a.png',
    })
    const components = createTemplate.mock.calls[0][0].components
    expect(components[0]).toEqual({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: ['4::handle'] },
    })
    expect(templateRepo.upsertSynced).toHaveBeenCalledWith(
      expect.objectContaining({
        headerFormat: 'IMAGE',
        headerMediaUrl: input.headerMediaUrl,
        buttons: input.buttons,
      }),
    )
    expect(dto.headerFormat).toBe('IMAGE')
  })

  it('refuses media outside the workspace upload', async () => {
    readMedia.mockResolvedValue(err(validationError('nope')))
    expectErr(
      await WhatsAppTemplateService.create('u1', 'ws1', input),
      'VALIDATION_ERROR',
    )
    expect(createTemplate).not.toHaveBeenCalled()
  })

  it('maps an upload failure to BAD_REQUEST', async () => {
    readMedia.mockResolvedValue(
      ok({ body: Buffer.from('x'), contentType: 'image/png', fileName: 'a' }),
    )
    upload.mockRejectedValueOnce(new Error('Token sem permissão'))
    const error = expectErr(
      await WhatsAppTemplateService.create('u1', 'ws1', input),
      'BAD_REQUEST',
    )
    expect(error.message).toBe('Token sem permissão')

    upload.mockRejectedValueOnce('weird')
    expect(
      expectErr(await WhatsAppTemplateService.create('u1', 'ws1', input))
        .message,
    ).toBe('Falha ao enviar a mídia do cabeçalho para a Meta')
  })

  it('a text header keeps no media and no buttons when none are given', async () => {
    createTemplate.mockResolvedValue({
      name: 'aviso',
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'PENDING',
      components: [],
    })
    expectOk(
      await WhatsAppTemplateService.create('u1', 'ws1', {
        connectionId: 'conn1',
        name: 'aviso',
        language: 'pt_BR',
        category: 'UTILITY',
        headerFormat: 'TEXT',
        headerText: 'Aviso',
        body: 'Oi',
      }),
    )
    expect(readMedia).not.toHaveBeenCalled()
    const saved = templateRepo.upsertSynced.mock.calls[0][0]
    expect(saved.headerFormat).toBe('TEXT')
    expect(saved.headerMediaUrl).toBeNull()
    expect(saved.buttons).toBeUndefined()
  })
})

describe('updateButtons()', () => {
  const stored = createFakeWhatsAppTemplate({
    id: 'tpl1',
    workspaceId: 'ws1',
    components: [metaButtons],
  })
  const next = [
    {
      id: 'b1',
      type: 'REPLY' as const,
      label: 'Sim',
      actions: [
        { kind: 'ASSIGN_TEAM' as const, teamId: 't1' },
        { kind: 'REPLY' as const, text: 'Ok' },
      ],
    },
    {
      id: 'b2',
      type: 'URL' as const,
      label: 'Site',
      url: 'https://steel.app',
    },
  ]

  it('saves the actions when the buttons match the approved ones', async () => {
    templateRepo.findById.mockResolvedValue(ok(stored))

    const dto = expectOk(
      await WhatsAppTemplateService.updateButtons('u1', 'ws1', 'tpl1', {
        buttons: next,
      }),
    )

    expect(templateRepo.findById).toHaveBeenCalledWith('tpl1', 'ws1')
    expect(templateRepo.update).toHaveBeenCalledWith('tpl1', { buttons: next })
    expect(dto.buttons).toEqual(next)
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        meta: { buttons: 2, actions: 2 },
      }),
    )
  })

  it.each([
    ['fewer buttons', [next[0]]],
    ['another label', [{ ...next[0], label: 'Não' }, next[1]]],
    ['another type', [next[1], next[0]]],
    ['another link', [next[0], { ...next[1], url: 'https://x.dev' }]],
  ])('refuses %s', async (_name, buttons) => {
    templateRepo.findById.mockResolvedValue(ok(stored))
    expectErr(
      await WhatsAppTemplateService.updateButtons('u1', 'ws1', 'tpl1', {
        buttons: buttons as typeof next,
      }),
      'VALIDATION_ERROR',
    )
    expect(templateRepo.update).not.toHaveBeenCalled()
  })

  it('returns not found, db errors and forbids a member', async () => {
    templateRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppTemplateService.updateButtons('u1', 'ws1', 'x', {
        buttons: next,
      }),
      'WHATSAPP_TEMPLATE_NOT_FOUND',
    )

    templateRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppTemplateService.updateButtons('u1', 'ws1', 'x', {
        buttons: next,
      }),
      'DATABASE_ERROR',
    )

    templateRepo.findById.mockResolvedValue(ok(stored))
    templateRepo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppTemplateService.updateButtons('u1', 'ws1', 'tpl1', {
        buttons: next,
      }),
      'DATABASE_ERROR',
    )

    as('MEMBER')
    expectErr(
      await WhatsAppTemplateService.updateButtons('u1', 'ws1', 'tpl1', {
        buttons: next,
      }),
      'FORBIDDEN',
    )
  })
})

describe('sync() quality', () => {
  const raw = (overrides: object) =>
    ({
      name: 'promo',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      components: [{ type: 'HEADER', format: 'VIDEO' }],
      ...overrides,
    }) as never

  it('stores quality, reason and header format', async () => {
    templateRepo.listByWorkspace.mockResolvedValue(ok([]))
    fetchTemplates.mockResolvedValue([
      raw({
        quality_score: { score: 'YELLOW', date: 1_700_000_000 },
        rejected_reason: 'NONE',
      }),
      raw({
        name: 'b',
        status: 'PAUSED',
        quality_score: { score: 'LOW' },
        rejected_reason: 'SCAM',
        components: 'bad',
      }),
    ])

    expectOk(await WhatsAppTemplateService.sync('u1', 'ws1', 'conn1'))

    expect(templateRepo.upsertSynced.mock.calls[0][0]).toMatchObject({
      quality: 'YELLOW',
      qualityUpdatedAt: new Date(1_700_000_000_000),
      statusReason: null,
      headerFormat: 'VIDEO',
    })
    expect(templateRepo.upsertSynced.mock.calls[1][0]).toMatchObject({
      status: 'PAUSED',
      quality: 'RED',
      statusReason: 'SCAM',
      headerFormat: null,
      components: [],
    })
    // First sight is not a transition: nobody is notified.
    expect(notify).not.toHaveBeenCalled()
  })

  it('warns the admins when a known template falls into risk', async () => {
    templateRepo.listByWorkspace.mockResolvedValue(
      ok([
        createFakeWhatsAppTemplate({
          connectionId: 'conn1',
          name: 'promo',
          language: 'pt_BR',
          quality: 'GREEN',
        }),
        createFakeWhatsAppTemplate({
          connectionId: 'conn1',
          name: 'aviso',
          language: 'pt_BR',
          quality: 'GREEN',
        }),
        createFakeWhatsAppTemplate({
          connectionId: 'conn1',
          name: 'velho',
          language: 'pt_BR',
          quality: 'RED',
        }),
      ]),
    )
    fetchTemplates.mockResolvedValue([
      raw({ quality_score: { score: 'RED' } }),
      raw({ name: 'aviso', status: 'DISABLED' }),
      raw({ name: 'velho', quality_score: { score: 'RED' } }),
    ])

    expectOk(await WhatsAppTemplateService.sync('u1', 'ws1', 'conn1'))

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({
      kind: 'WHATSAPP_TEMPLATE_QUALITY',
      userIds: ['owner', 'admin'],
      actorId: 'u1',
      title: '2 templates com qualidade em risco',
      body: 'Evite enviar até a qualidade melhorar: promo (pt_BR), aviso (pt_BR).',
      path: '/zap/templates',
    })
  })

  it('uses the singular title for one template at risk', async () => {
    templateRepo.listByWorkspace.mockResolvedValue(
      ok([
        createFakeWhatsAppTemplate({
          connectionId: 'conn1',
          name: 'promo',
          language: 'pt_BR',
        }),
      ]),
    )
    fetchTemplates.mockResolvedValue([raw({ status: 'PAUSED' })])
    expectOk(await WhatsAppTemplateService.sync('u1', 'ws1', 'conn1'))
    expect(notify.mock.calls[0][0].title).toBe(
      'Template com qualidade em risco',
    )
  })
})

describe('applyWebhookUpdate()', () => {
  const known = createFakeWhatsAppTemplate({
    id: 'tpl1',
    workspaceId: 'ws1',
    connectionId: 'conn1',
    name: 'promo',
    language: 'pt_BR',
    status: 'APPROVED',
    quality: 'GREEN',
  })

  beforeEach(() => {
    connectionRepo.listByMetaWabaId.mockResolvedValue(ok([metaConnection]))
    templateRepo.findByConnectionAndName.mockResolvedValue(ok(known))
    templateRepo.update.mockImplementation(async (_id, data) =>
      ok({ ...known, ...(data as object) } as never),
    )
  })

  const status = (event: string, reason?: string) =>
    WhatsAppTemplateService.applyWebhookUpdate({
      wabaId: 'waba-1',
      field: 'message_template_status_update',
      value: {
        event,
        reason,
        message_template_name: 'promo',
        message_template_language: 'pt_BR',
      },
    })

  it('pauses the template and warns the admins', async () => {
    expect(expectOk(await status('PAUSED', 'LOW_QUALITY'))).toEqual({
      updated: 1,
    })
    expect(connectionRepo.listByMetaWabaId).toHaveBeenCalledWith('waba-1')
    expect(templateRepo.update).toHaveBeenCalledWith('tpl1', {
      status: 'PAUSED',
      statusReason: 'LOW_QUALITY',
    })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_TEMPLATE_QUALITY',
        actorId: null,
        body: 'Evite enviar até a qualidade melhorar: promo (pt_BR).',
      }),
    )
  })

  it('a rejection notifies as rejected', async () => {
    expectOk(await status('REJECTED', 'INVALID_FORMAT'))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({
      kind: 'WHATSAPP_TEMPLATE_REJECTED',
      title: 'Template reprovado pela Meta',
      meta: { templateId: 'tpl1', rejected: 1 },
    })
  })

  it('reinstated means approved again, silently', async () => {
    expectOk(await status('REINSTATED', 'NONE'))
    expect(templateRepo.update).toHaveBeenCalledWith('tpl1', {
      status: 'APPROVED',
      statusReason: null,
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores unknown events, templates and incomplete payloads', async () => {
    expect(expectOk(await status('FLAGGED'))).toEqual({ updated: 0 })

    templateRepo.findByConnectionAndName.mockResolvedValue(ok(null))
    expect(expectOk(await status('APPROVED'))).toEqual({ updated: 0 })

    expect(
      expectOk(
        await WhatsAppTemplateService.applyWebhookUpdate({
          wabaId: 'waba-1',
          field: 'message_template_quality_update',
          value: { new_quality_score: 'RED' },
        }),
      ),
    ).toEqual({ updated: 0 })
    expect(connectionRepo.listByMetaWabaId).toHaveBeenCalledTimes(2)
    expect(templateRepo.update).not.toHaveBeenCalled()
  })

  it('updates the quality and warns only on the drop to RED', async () => {
    const quality = (score?: string) =>
      WhatsAppTemplateService.applyWebhookUpdate({
        wabaId: 'waba-1',
        field: 'message_template_quality_update',
        value: {
          new_quality_score: score,
          message_template_name: 'promo',
          message_template_language: 'pt_BR',
        },
      })

    expectOk(await quality('YELLOW'))
    expect(templateRepo.update).toHaveBeenLastCalledWith('tpl1', {
      quality: 'YELLOW',
      qualityUpdatedAt: expect.any(Date),
    })
    expect(notify).not.toHaveBeenCalled()

    expectOk(await quality(undefined))
    expect(templateRepo.update).toHaveBeenLastCalledWith(
      'tpl1',
      expect.objectContaining({ quality: 'UNKNOWN' }),
    )

    expectOk(await quality('RED'))
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not notify for ServiceDesk connections', async () => {
    connectionRepo.listByMetaWabaId.mockResolvedValue(
      ok([{ ...metaConnection, module: 'SERVICE_DESK' }]),
    )
    expect(expectOk(await status('DISABLED'))).toEqual({ updated: 1 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    templateRepo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(await status('PAUSED'), 'DATABASE_ERROR')

    templateRepo.findByConnectionAndName.mockResolvedValueOnce(
      err(databaseError()),
    )
    expectErr(await status('PAUSED'), 'DATABASE_ERROR')

    connectionRepo.listByMetaWabaId.mockResolvedValueOnce(err(databaseError()))
    expectErr(await status('PAUSED'), 'DATABASE_ERROR')
  })
})
