import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  forbidden,
  moduleDisabled,
  validationError,
} from '@/src/errors'
import type { ApiSession } from '@/src/lib/api/session'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock('@/src/services/user.service', () => ({
  UserService: { getProfile: vi.fn() },
}))
vi.mock('@/src/services/crm-pipeline.service', () => ({
  CrmPipelineService: { list: vi.fn() },
  CrmPipelineStageService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-lead.service', () => ({
  CrmLeadService: { intake: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-connection.service', () => ({
  WhatsAppConnectionService: { list: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-contact.service', () => ({
  WhatsAppContactService: { findOrCreate: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-conversation.service', () => ({
  WhatsAppConversationService: { start: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-message.service', () => ({
  WhatsAppMessageService: { sendTemplate: vi.fn() },
}))
vi.mock('@/src/services/sd-phase.service', () => ({
  SdPhaseService: { list: vi.fn(), listTransitions: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { ApiV1Service } from '@/src/services/api-v1.service'
import { assertModuleMember } from '@/src/services/authz'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import {
  CrmPipelineService,
  CrmPipelineStageService,
} from '@/src/services/crm-pipeline.service'
import { SdPhaseService } from '@/src/services/sd-phase.service'
import { UserService } from '@/src/services/user.service'
import { WhatsAppConnectionService } from '@/src/services/whatsapp-connection.service'
import { WhatsAppContactService } from '@/src/services/whatsapp-contact.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { WhatsAppMessageService } from '@/src/services/whatsapp-message.service'
import type { SdPhaseDTO, SdPhaseTransitionDTO } from '@/types/sd-config'
import type { UserDTO } from '@/types/user'

const SESSION: ApiSession = {
  tokenId: 'tok_1',
  userId: 'user_1',
  workspaceId: 'ws_1',
  scopes: ['api:read'],
  modules: ['CRM', 'SERVICE_DESK'],
  expiresAt: new Date('2027-01-15T12:00:00.000Z'),
}

function profile(memberships: UserDTO['memberships']): UserDTO {
  return {
    id: 'user_1',
    name: 'Ana Souza',
    email: 'ana@empresa.com.br',
    username: 'ana',
    emailVerified: true,
    image: null,
    coverImage: null,
    pabxExtension: null,
    pabxDeviceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    deletionScheduledAt: null,
    acceptedTermsAt: '2026-01-01T00:00:00.000Z',
    acceptedPrivacyAt: '2026-01-01T00:00:00.000Z',
    onboardingStep: null,
    role: null,
    goals: [],
    memberships,
  }
}

const member = { role: 'MEMBER', isPrivileged: false, permissions: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertModuleMember).mockResolvedValue(ok(member as never))
})

describe('ApiV1Service.me', () => {
  it("returns the token's owner, workspace, role and token", async () => {
    vi.mocked(UserService.getProfile).mockResolvedValue(
      ok(
        profile([
          {
            workspaceId: 'ws_0',
            slug: 'outra',
            name: 'Outra',
            role: 'OWNER',
            logoUrl: null,
          },
          {
            workspaceId: 'ws_1',
            slug: 'empresa',
            name: 'Empresa',
            role: 'ADMIN',
            logoUrl: null,
          },
        ]),
      ),
    )

    const me = expectOk(await ApiV1Service.me(SESSION))

    expect(UserService.getProfile).toHaveBeenCalledWith('user_1')
    expect(me).toEqual({
      user: { id: 'user_1', name: 'Ana Souza', email: 'ana@empresa.com.br' },
      workspace: { id: 'ws_1', slug: 'empresa', name: 'Empresa' },
      role: 'ADMIN',
      scopes: ['api:read'],
      modules: ['CRM', 'SERVICE_DESK'],
      token: { id: 'tok_1', expiresAt: '2027-01-15T12:00:00.000Z' },
    })
  })

  it('answers 401 when the owner is no longer in the workspace', async () => {
    vi.mocked(UserService.getProfile).mockResolvedValue(ok(profile([])))
    expectErr(await ApiV1Service.me(SESSION), 'UNAUTHORIZED')
  })

  it('propagates a profile lookup failure', async () => {
    vi.mocked(UserService.getProfile).mockResolvedValue(
      err(databaseError('boom')),
    )
    expectErr(await ApiV1Service.me(SESSION), 'DATABASE_ERROR')
  })
})

describe('ApiV1Service.listPipelines', () => {
  const pipeline = (id: string) => ({ id, name: id }) as never
  const stage = (id: string) => ({ id }) as never

  it('returns each pipeline with its stages, in order', async () => {
    vi.mocked(CrmPipelineService.list).mockResolvedValue(
      ok([pipeline('p1'), pipeline('p2')]),
    )
    vi.mocked(CrmPipelineStageService.list).mockImplementation(
      async (_actor, _ws, pipelineId) =>
        ok(pipelineId === 'p1' ? [stage('s1'), stage('s2')] : []),
    )

    const pipelines = expectOk(await ApiV1Service.listPipelines('u1', 'ws1'))

    expect(pipelines).toEqual([
      { id: 'p1', name: 'p1', stages: [{ id: 's1' }, { id: 's2' }] },
      { id: 'p2', name: 'p2', stages: [] },
    ])
    expect(CrmPipelineStageService.list).toHaveBeenCalledWith('u1', 'ws1', 'p1')
  })

  it('propagates the authorization error of the pipeline list', async () => {
    vi.mocked(CrmPipelineService.list).mockResolvedValue(err(forbidden()))
    expectErr(await ApiV1Service.listPipelines('u1', 'ws1'), 'FORBIDDEN')
    expect(CrmPipelineStageService.list).not.toHaveBeenCalled()
  })

  it('propagates a stage lookup failure', async () => {
    vi.mocked(CrmPipelineService.list).mockResolvedValue(ok([pipeline('p1')]))
    vi.mocked(CrmPipelineStageService.list).mockResolvedValue(
      err(databaseError('boom')),
    )
    expectErr(await ApiV1Service.listPipelines('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('ApiV1Service.importLeads', () => {
  const intake = vi.mocked(CrmLeadService.intake)
  const lead = { id: 'lead_1' } as never

  it('creates, skips duplicates and reports refused rows by CSV line', async () => {
    intake
      .mockResolvedValueOnce(ok({ lead, created: true }))
      .mockResolvedValueOnce(ok({ lead, created: false }))
      .mockResolvedValueOnce(
        err(
          validationError('Dados inválidos', [
            { path: ['emails', 0], message: 'E-mail inválido' },
          ]),
        ),
      )
      .mockResolvedValueOnce(err(databaseError('falhou')))
    const csv = [
      'Nome;E-mail;Telefone;Empresa;Cargo;Cidade;LinkedIn;Origem;Canal',
      'Carlos Lima;carlos@x.com, c2@x.com;11 9999-0000 | 11 8888-0000;Empresa;CTO;SP;in/carlos;Site;Web',
      'Bia;bia@x.com;;;;;;;',
      'Rui;não-é-email;;;;;;;',
      'Lia;lia@x.com;;;;;;;',
    ].join('\n')

    const result = expectOk(
      await ApiV1Service.importLeads('u1', 'ws1', csv, 'Feira'),
    )

    expect(result).toEqual({
      total: 4,
      created: 1,
      skipped: 1,
      errors: [
        {
          row: 4,
          code: 'VALIDATION_ERROR',
          message: 'emails.0: E-mail inválido',
        },
        { row: 5, code: 'DATABASE_ERROR', message: 'falhou' },
      ],
    })
    expect(assertModuleMember).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'leads',
      action: 'CREATE',
    })
    expect(intake).toHaveBeenNthCalledWith(
      1,
      'ws1',
      { kind: 'user', userId: 'u1' },
      {
        name: 'Carlos Lima',
        emails: ['carlos@x.com', 'c2@x.com'],
        phones: ['11 9999-0000', '11 8888-0000'],
        company: 'Empresa',
        jobTitle: 'CTO',
        city: 'SP',
        linkedin: 'in/carlos',
        source: 'Site',
        channel: 'Web',
      },
    )
    // Blank source → the import's default.
    expect(intake.mock.calls[1][2]).toMatchObject({
      name: 'Bia',
      emails: ['bia@x.com'],
      phones: [],
      source: 'Feira',
      company: undefined,
    })
    expect(logger.info).toHaveBeenCalledWith(
      'api_v1.crm_lead_import',
      expect.objectContaining({ total: 4, created: 1, skipped: 1, failed: 2 }),
    )
  })

  it('uses "API" as the source when neither the row nor the call has one', async () => {
    intake.mockResolvedValue(ok({ lead, created: true }))
    await ApiV1Service.importLeads('u1', 'ws1', 'name,phone\nAna,11999990000')
    expect(intake.mock.calls[0][2]).toMatchObject({ source: 'API' })
  })

  it('reports a refused row without Zod issues by its message', async () => {
    intake.mockResolvedValue(err(validationError('Sem contato')))
    const result = expectOk(
      await ApiV1Service.importLeads('u1', 'ws1', 'name\nAna'),
    )
    expect(result.errors).toEqual([
      { row: 2, code: 'VALIDATION_ERROR', message: 'Sem contato' },
    ])
    // A row with no name still goes to intake, which refuses it.
    intake.mockResolvedValue(
      err(
        validationError('Dados inválidos', [{ path: [], message: 'Informe' }]),
      ),
    )
    const empty = expectOk(
      await ApiV1Service.importLeads('u1', 'ws1', 'name,email\n,a@x.com'),
    )
    expect(empty.errors[0].message).toBe('Informe')
    expect(intake.mock.calls.at(-1)?.[2]).toMatchObject({ name: '' })
    intake.mockResolvedValue(err(validationError('Dados inválidos', [{}])))
    const bare = expectOk(
      await ApiV1Service.importLeads('u1', 'ws1', 'name\nA'),
    )
    expect(bare.errors[0].message).toBe('Dados inválidos')
  })

  it.each([
    ['without the name column', 'email\na@x.com', 'coluna name'],
    ['without data rows', 'name,email', 'não tem linhas'],
    ['empty', '', 'coluna name'],
  ])('refuses a CSV %s', async (_label, csv, message) => {
    const error = expectErr(
      await ApiV1Service.importLeads('u1', 'ws1', csv),
      'VALIDATION_ERROR',
    )
    expect(error.message).toContain(message)
    expect(intake).not.toHaveBeenCalled()
  })

  it('refuses more than 5,000 rows before importing any', async () => {
    const csv = [
      'name',
      ...Array.from({ length: 5001 }, (_, i) => `L${i}`),
    ].join('\n')
    const error = expectErr(
      await ApiV1Service.importLeads('u1', 'ws1', csv),
      'VALIDATION_ERROR',
    )
    expect(error.message).toContain('5001')
    expect(intake).not.toHaveBeenCalled()
  })

  it('refuses a user without lead creation in the CRM', async () => {
    vi.mocked(assertModuleMember).mockResolvedValue(err(moduleDisabled()))
    expectErr(
      await ApiV1Service.importLeads('u1', 'ws1', 'name\nAna'),
      'MODULE_DISABLED',
    )
    expect(intake).not.toHaveBeenCalled()
  })
})

describe('ApiV1Service.sendWhatsAppTemplate', () => {
  const message = { id: 'msg_1' } as never
  const template = { templateName: 'boas_vindas', language: 'pt_BR' }

  it('sends to an existing conversation', async () => {
    vi.mocked(WhatsAppMessageService.sendTemplate).mockResolvedValue(
      ok(message),
    )

    const sent = expectOk(
      await ApiV1Service.sendWhatsAppTemplate('u1', 'ws1', {
        conversationId: 'conv_1',
        ...template,
        components: [{ type: 'body' }],
      }),
    )

    expect(sent).toBe(message)
    expect(WhatsAppConversationService.start).not.toHaveBeenCalled()
    expect(WhatsAppMessageService.sendTemplate).toHaveBeenCalledWith(
      'u1',
      'ws1',
      'conv_1',
      { ...template, components: [{ type: 'body' }] },
    )
  })

  it("opens (or reuses) the contact's conversation, then sends", async () => {
    vi.mocked(WhatsAppConversationService.start).mockResolvedValue(
      ok({ id: 'conv_2' } as never),
    )
    vi.mocked(WhatsAppMessageService.sendTemplate).mockResolvedValue(
      ok(message),
    )

    await ApiV1Service.sendWhatsAppTemplate('u1', 'ws1', {
      contactId: 'ct_1',
      connectionId: 'cn_1',
      ...template,
    })

    expect(WhatsAppConversationService.start).toHaveBeenCalledWith(
      'u1',
      'ws1',
      {
        contactId: 'ct_1',
        connectionId: 'cn_1',
      },
    )
    expect(WhatsAppMessageService.sendTemplate).toHaveBeenCalledWith(
      'u1',
      'ws1',
      'conv_2',
      { ...template, components: undefined },
    )
  })

  describe('to a phone number', () => {
    const connection = (id: string, status: string) => ({ id, status }) as never
    const sendTo = (extra: Record<string, string> = {}) =>
      ApiV1Service.sendWhatsAppTemplate('u1', 'ws1', {
        to: '+5511999990000',
        ...template,
        ...extra,
      })

    beforeEach(() => {
      vi.mocked(WhatsAppContactService.findOrCreate).mockResolvedValue(
        ok({ id: 'ct_9' } as never),
      )
      vi.mocked(WhatsAppConversationService.start).mockResolvedValue(
        ok({ id: 'conv_9' } as never),
      )
      vi.mocked(WhatsAppMessageService.sendTemplate).mockResolvedValue(
        ok(message),
      )
    })

    it('finds or creates the contact and uses the only connected connection', async () => {
      vi.mocked(WhatsAppConnectionService.list).mockResolvedValue(
        ok([
          connection('cn_off', 'DISCONNECTED'),
          connection('cn_on', 'CONNECTED'),
        ]),
      )

      expectOk(await sendTo())

      expect(WhatsAppContactService.findOrCreate).toHaveBeenCalledWith(
        'u1',
        'ws1',
        {
          waId: '5511999990000',
        },
      )
      expect(WhatsAppConversationService.start).toHaveBeenCalledWith(
        'u1',
        'ws1',
        {
          contactId: 'ct_9',
          connectionId: 'cn_on',
        },
      )
      expect(WhatsAppMessageService.sendTemplate).toHaveBeenCalledWith(
        'u1',
        'ws1',
        'conv_9',
        expect.objectContaining({ templateName: 'boas_vindas' }),
      )
    })

    it('uses the only connection even when none reports CONNECTED', async () => {
      vi.mocked(WhatsAppConnectionService.list).mockResolvedValue(
        ok([connection('cn_meta', 'CONNECTING')]),
      )
      expectOk(await sendTo())
      expect(
        vi.mocked(WhatsAppConversationService.start).mock.calls[0][2],
      ).toEqual({
        contactId: 'ct_9',
        connectionId: 'cn_meta',
      })
    })

    it('takes the connection of the call without listing them', async () => {
      expectOk(await sendTo({ connectionId: 'cn_x' }))
      expect(WhatsAppConnectionService.list).not.toHaveBeenCalled()
      expect(
        vi.mocked(WhatsAppConversationService.start).mock.calls[0][2],
      ).toEqual({
        contactId: 'ct_9',
        connectionId: 'cn_x',
      })
    })

    it.each([
      [
        'several connected connections',
        [connection('a', 'CONNECTED'), connection('b', 'CONNECTED')],
        'mais de uma conexão',
      ],
      [
        'several connections, none connected',
        [connection('a', 'ERROR'), connection('b', 'DISCONNECTED')],
        'mais de uma conexão',
      ],
      ['no connection', [], 'não tem conexão'],
    ])('answers 422 with %s', async (_label, list, message) => {
      vi.mocked(WhatsAppConnectionService.list).mockResolvedValue(ok(list))
      const error = expectErr(await sendTo(), 'VALIDATION_ERROR')
      expect(error.message).toContain(message)
      expect(WhatsAppContactService.findOrCreate).not.toHaveBeenCalled()
    })

    it('propagates connection and contact errors', async () => {
      vi.mocked(WhatsAppConnectionService.list).mockResolvedValue(
        err(moduleDisabled()),
      )
      expectErr(await sendTo(), 'MODULE_DISABLED')

      vi.mocked(WhatsAppContactService.findOrCreate).mockResolvedValue(
        err(forbidden()),
      )
      expectErr(await sendTo({ connectionId: 'cn_x' }), 'FORBIDDEN')
      expect(WhatsAppConversationService.start).not.toHaveBeenCalled()
    })
  })

  it('stops when the conversation cannot be opened', async () => {
    vi.mocked(WhatsAppConversationService.start).mockResolvedValue(
      err(forbidden('Este contato já está em atendimento com outra pessoa')),
    )
    expectErr(
      await ApiV1Service.sendWhatsAppTemplate('u1', 'ws1', {
        contactId: 'ct_1',
        connectionId: 'cn_1',
        ...template,
      }),
      'FORBIDDEN',
    )
    expect(WhatsAppMessageService.sendTemplate).not.toHaveBeenCalled()
  })
})

function phase(
  id: string,
  ticketType: SdPhaseDTO['ticketType'],
  overrides: Partial<SdPhaseDTO> = {},
): SdPhaseDTO {
  return {
    id,
    ticketType,
    name: id,
    description: null,
    color: null,
    category: 'IN_PROGRESS',
    completionPercent: 0,
    position: 0,
    isInitial: false,
    pausesSla: false,
    requiresApproval: false,
    requiredFields: [],
    wipLimit: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function transition(from: string, to: string): SdPhaseTransitionDTO {
  return {
    id: `${from}-${to}`,
    fromPhaseId: from,
    toPhaseId: to,
    allowedDepartmentIds: [],
  }
}

describe('ApiV1Service.listSdPhases', () => {
  beforeEach(() => {
    vi.mocked(SdPhaseService.list).mockReset()
    vi.mocked(SdPhaseService.listTransitions).mockReset()
  })

  it('lists active phases with the next phases of ruled types and null for free flows', async () => {
    vi.mocked(SdPhaseService.list).mockResolvedValue(
      ok([
        phase('inc-new', 'INCIDENT', { isInitial: true }),
        phase('inc-work', 'INCIDENT'),
        phase('inc-old', 'INCIDENT', { active: false }),
        phase('inc-done', 'INCIDENT', { category: 'RESOLVED' }),
        phase('req-new', 'SERVICE_REQUEST'),
      ]),
    )
    vi.mocked(SdPhaseService.listTransitions).mockResolvedValue(
      ok([
        transition('inc-new', 'inc-work'),
        transition('inc-new', 'inc-old'),
        transition('inc-work', 'inc-done'),
      ]),
    )

    const phases = expectOk(await ApiV1Service.listSdPhases('user_1', 'ws_1'))

    expect(SdPhaseService.list).toHaveBeenCalledWith('user_1', 'ws_1', {
      ticketType: undefined,
      includeInactive: true,
    })
    expect(SdPhaseService.listTransitions).toHaveBeenCalledWith(
      'user_1',
      'ws_1',
      undefined,
    )
    expect(phases.map((p) => [p.id, p.nextPhaseIds])).toEqual([
      // The transition into the inactive phase is left out.
      ['inc-new', ['inc-work']],
      ['inc-work', ['inc-done']],
      // Ruled type, no rule out of it: a dead end.
      ['inc-done', []],
      ['req-new', null],
    ])
    expect(phases[0]).toMatchObject({ isInitial: true, ticketType: 'INCIDENT' })
  })

  it('treats a type ruled only from an inactive phase as ruled', async () => {
    vi.mocked(SdPhaseService.list).mockResolvedValue(
      ok([
        phase('chg-old', 'CHANGE', { active: false }),
        phase('chg-new', 'CHANGE'),
      ]),
    )
    vi.mocked(SdPhaseService.listTransitions).mockResolvedValue(
      ok([transition('chg-old', 'chg-new')]),
    )

    const phases = expectOk(
      await ApiV1Service.listSdPhases('user_1', 'ws_1', 'CHANGE'),
    )

    expect(SdPhaseService.list).toHaveBeenCalledWith('user_1', 'ws_1', {
      ticketType: 'CHANGE',
      includeInactive: true,
    })
    expect(phases).toEqual([
      expect.objectContaining({ id: 'chg-new', nextPhaseIds: [] }),
    ])
  })

  it('ignores a transition whose phase is outside the listed ones', async () => {
    vi.mocked(SdPhaseService.list).mockResolvedValue(
      ok([phase('prb-new', 'PROBLEM')]),
    )
    vi.mocked(SdPhaseService.listTransitions).mockResolvedValue(
      ok([transition('ghost', 'prb-new')]),
    )

    const phases = expectOk(await ApiV1Service.listSdPhases('user_1', 'ws_1'))
    expect(phases[0].nextPhaseIds).toBeNull()
  })

  it('propagates the access error of the phase list', async () => {
    vi.mocked(SdPhaseService.list).mockResolvedValue(
      err(moduleDisabled('ServiceDesk')),
    )

    expectErr(
      await ApiV1Service.listSdPhases('user_1', 'ws_1'),
      'MODULE_DISABLED',
    )
    expect(SdPhaseService.listTransitions).not.toHaveBeenCalled()
  })

  it('propagates a database error of the transitions', async () => {
    vi.mocked(SdPhaseService.list).mockResolvedValue(ok([]))
    vi.mocked(SdPhaseService.listTransitions).mockResolvedValue(
      err(databaseError('boom')),
    )

    expectErr(
      await ApiV1Service.listSdPhases('user_1', 'ws_1'),
      'DATABASE_ERROR',
    )
  })
})
