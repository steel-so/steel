import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeAutomationConfig,
  createFakeEscalationConfig,
  createFakeSlaConfig,
  modelEnvelope,
} from '@/src/__tests__/factories/nov-sd-nl-config.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiQuotaExceeded,
  databaseError,
  forbidden,
  sdConfigNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/sd-access')
vi.mock('@/src/services/sd-settings.service')
vi.mock('@/src/services/sd-priority.service')
vi.mock('@/src/services/sd-calendar.service')
vi.mock('@/src/services/sd-department.service')
vi.mock('@/src/services/sd-category.service')
vi.mock('@/src/services/sd-phase.service')
vi.mock('@/src/services/sd-sla-policy.service')
vi.mock('@/src/services/sd-automation-rule.service')
vi.mock('@/src/services/sd-escalation-rule.service')
vi.mock('@/src/repositories/sd-config.repository')
vi.mock('@/src/services/sd-config-support', () => ({
  assertSdRefs: vi.fn(),
  sdAdminMutation: vi.fn(),
}))

import { logger } from '@/lib/axiom/logger'
import { SdConfigRepository } from '@/src/repositories/sd-config.repository'
import { AiUsageService } from '../ai-usage.service'
import { SdAccess } from '../sd-access'
import { SdAutomationRuleService } from '../sd-automation-rule.service'
import { SdCalendarService } from '../sd-calendar.service'
import { SdCategoryService } from '../sd-category.service'
import { assertSdRefs, sdAdminMutation } from '../sd-config-support'
import { SdDepartmentService } from '../sd-department.service'
import { SdEscalationRuleService } from '../sd-escalation-rule.service'
import { SdNlConfigService } from '../sd-nl-config.service'
import { SdPhaseService } from '../sd-phase.service'
import { SdPriorityService } from '../sd-priority.service'
import { SdSettingsService } from '../sd-settings.service'
import { SdSlaPolicyService } from '../sd-sla-policy.service'

const WS = 'ws1'
const ACTOR = 'u1'
const NOW = new Date('2026-10-30T12:00:00Z')

const access = vi.mocked(SdAccess)
const settings = vi.mocked(SdSettingsService)
const ai = vi.mocked(AiUsageService)
const refsCheck = vi.mocked(assertSdRefs)
const mutation = vi.mocked(sdAdminMutation)
const sla = vi.mocked(SdSlaPolicyService)
const automation = vi.mocked(SdAutomationRuleService)
const escalation = vi.mocked(SdEscalationRuleService)
const members = vi.mocked(SdConfigRepository)
const provider = { id: 'anthropic' as const, chat: vi.fn() }

function named(id: string, name: string) {
  return { id, name }
}

function chat(text: string) {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 100, outputTokens: 40 },
    stopReason: 'end' as const,
  }
}

function saved(id = 'new1', name = 'Nome') {
  return ok({ id, name } as never)
}

beforeEach(() => {
  vi.resetAllMocks()
  access.requireAdmin.mockResolvedValue(ok({} as never))
  settings.get.mockResolvedValue(ok({ aiEnabled: true } as never))
  vi.mocked(SdPriorityService.list).mockResolvedValue(
    ok([named('pri-high', 'Alta')] as never),
  )
  vi.mocked(SdCalendarService.list).mockResolvedValue(
    ok([named('cal-1', 'Horário comercial')] as never),
  )
  vi.mocked(SdDepartmentService.list).mockResolvedValue(
    ok([named('dep-net', 'Redes')] as never),
  )
  vi.mocked(SdCategoryService.list).mockResolvedValue(ok([] as never))
  vi.mocked(SdPhaseService.list).mockResolvedValue(ok([] as never))
  members.listWorkspaceMembers.mockResolvedValue(
    ok([{ user: { id: 'usr-1', name: 'Ana' } }] as never),
  )
  ai.prepare.mockResolvedValue(
    ok({
      provider,
      model: { model: 'm', key: 'k', provider: 'anthropic' },
    } as never),
  )
  ai.record.mockResolvedValue(undefined as never)
  refsCheck.mockResolvedValue(ok(true))
  mutation.mockImplementation(async (o) => {
    const result = await o.run({} as never)
    if (result.ok && typeof o.targetId === 'function') o.targetId(result.value)
    return result
  })
  provider.chat.mockResolvedValue(chat(modelEnvelope(createFakeSlaConfig())))
})

describe('SdNlConfigService.preview', () => {
  it('builds a creation preview and never saves', async () => {
    const out = expectOk(
      await SdNlConfigService.preview(
        ACTOR,
        WS,
        { kind: 'SLA', text: 'SLA para VIPs' },
        NOW,
      ),
    )
    expect(out).toMatchObject({
      kind: 'SLA',
      mode: 'create',
      targetId: null,
      diff: null,
      summary: 'Montei a configuração.',
    })
    expect(out.lines).toContain('Calendário: Horário comercial')
    expect(sla.create).not.toHaveBeenCalled()
    expect(sla.update).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
    expect(ai.record).toHaveBeenCalledOnce()
    const request = provider.chat.mock.calls[0][0]
    expect(request.messages).toEqual([
      { role: 'user', content: 'SLA para VIPs' },
    ])
    expect(request.system).toContain('pri-high="Alta"')
  })

  it('previews an adjustment with the field diff', async () => {
    const before = createFakeSlaConfig()
    sla.list.mockResolvedValue(ok([{ id: 'p1', ...before }] as never))
    provider.chat.mockResolvedValue(
      chat(
        modelEnvelope(
          createFakeSlaConfig({
            targets: [
              {
                priorityId: 'pri-high',
                firstResponseMinutes: 30,
                resolutionMinutes: 240,
              },
            ],
          }),
          { warnings: ['Mantive o calendário'] },
        ),
      ),
    )
    const out = expectOk(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'Aumente a primeira resposta para 30 minutos',
        targetId: 'p1',
      }),
    )
    expect(out.mode).toBe('update')
    expect(out.targetName).toBe('VIP')
    expect(out.warnings).toEqual(['Mantive o calendário'])
    expect(out.diff?.map((d) => d.field)).toEqual(['targets'])
    expect(provider.chat.mock.calls[0][0].system).toContain('AJUSTA')
  })

  it.each([
    ['AUTOMATION', automation.list, createFakeAutomationConfig()],
    ['ESCALATION', escalation.list, createFakeEscalationConfig()],
  ] as const)('supports %s', async (kind, list, config) => {
    list.mockResolvedValue(ok([{ id: 'r1', ...config }] as never))
    provider.chat.mockResolvedValue(chat(modelEnvelope(config)))
    const out = expectOk(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind,
        text: 'Faça algo útil',
        targetId: 'r1',
      }),
    )
    expect(out.kind).toBe(kind)
    expect(out.diff).toEqual([])
    expect(refsCheck).toHaveBeenCalled()
  })

  it('checks automation action references', async () => {
    provider.chat.mockResolvedValue(
      chat(modelEnvelope(createFakeAutomationConfig())),
    )
    expectOk(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'AUTOMATION',
        text: 'Regra de VPN',
      }),
    )
    expect(refsCheck).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        departmentIds: ['dep-net'],
        userIds: ['usr-1'],
      }),
    )
  })

  it('rejects non-admins before anything else', async () => {
    access.requireAdmin.mockResolvedValue(err(forbidden()))
    const e = expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'abcde',
      }),
    )
    expect(e.code).toBe('FORBIDDEN')
    expect(ai.prepare).not.toHaveBeenCalled()
  })

  it('fails when the AI is disabled for the module', async () => {
    settings.get.mockResolvedValue(ok({ aiEnabled: false } as never))
    expect(
      expectErr(
        await SdNlConfigService.preview(ACTOR, WS, {
          kind: 'SLA',
          text: 'abcde',
        }),
      ).code,
    ).toBe('SD_AI_DISABLED')
  })

  it('propagates settings and reference errors', async () => {
    settings.get.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'abcde',
      }),
    )
    settings.get.mockResolvedValue(ok({ aiEnabled: true } as never))
    const lists = [
      SdPriorityService.list,
      SdCalendarService.list,
      SdDepartmentService.list,
      SdCategoryService.list,
      SdPhaseService.list,
    ]
    for (const list of lists) {
      vi.mocked(list).mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await SdNlConfigService.preview(ACTOR, WS, {
          kind: 'SLA',
          text: 'abcde',
        }),
      )
    }
    members.listWorkspaceMembers.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'abcde',
      }),
    )
    expect(ai.prepare).not.toHaveBeenCalled()
  })

  it('fails with not found when the target rule does not exist', async () => {
    sla.list.mockResolvedValue(ok([] as never))
    expect(
      expectErr(
        await SdNlConfigService.preview(ACTOR, WS, {
          kind: 'SLA',
          text: 'abcde',
          targetId: 'nope',
        }),
      ).code,
    ).toBe(sdConfigNotFound().code)
    sla.list.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'abcde',
        targetId: 'nope',
      }),
    )
  })

  it('stops on quota exceeded without calling the model', async () => {
    ai.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10)))
    expect(
      expectErr(
        await SdNlConfigService.preview(ACTOR, WS, {
          kind: 'SLA',
          text: 'abcde',
        }),
      ).code,
    ).toBe('AI_QUOTA_EXCEEDED')
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('maps provider failures', async () => {
    provider.chat.mockRejectedValue(new Error('boom'))
    expect(
      expectErr(
        await SdNlConfigService.preview(ACTOR, WS, {
          kind: 'SLA',
          text: 'abcde',
        }),
      ).code,
    ).toBe('SD_NL_CONFIG_FAILED')
    expect(logger.error).toHaveBeenCalled()
    provider.chat.mockRejectedValue('texto')
    expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'abcde',
      }),
    )
  })

  it('fails on a malformed envelope or malformed configJson', async () => {
    provider.chat.mockResolvedValue(chat('not json'))
    expect(
      expectErr(
        await SdNlConfigService.preview(ACTOR, WS, {
          kind: 'SLA',
          text: 'abcde',
        }),
      ).code,
    ).toBe('SD_NL_CONFIG_FAILED')
    provider.chat.mockResolvedValue(
      chat(
        JSON.stringify({
          understood: true,
          summary: '',
          warnings: [],
          configJson: '{oops',
        }),
      ),
    )
    expect(
      expectErr(
        await SdNlConfigService.preview(ACTOR, WS, {
          kind: 'SLA',
          text: 'abcde',
        }),
      ).code,
    ).toBe('SD_NL_CONFIG_FAILED')
  })

  it('explains when the model did not understand the request', async () => {
    provider.chat.mockResolvedValue(
      chat(
        modelEnvelope({}, { understood: false, summary: 'Faltam detalhes.' }),
      ),
    )
    const e = expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'abcde',
      }),
    )
    expect(e.code).toBe('SD_NL_CONFIG_INVALID')
    expect(e.message).toBe('Faltam detalhes.')
    provider.chat.mockResolvedValue(
      chat(modelEnvelope({}, { understood: false, summary: '' })),
    )
    expect(
      expectErr(
        await SdNlConfigService.preview(ACTOR, WS, {
          kind: 'AUTOMATION',
          text: 'abcde',
        }),
      ).message,
    ).toContain('regra de automação')
  })

  it('rejects a configuration that fails the creation schema', async () => {
    provider.chat.mockResolvedValue(
      chat(
        modelEnvelope(
          createFakeSlaConfig({
            targets: [
              {
                priorityId: 'pri-high',
                firstResponseMinutes: 60,
                resolutionMinutes: 10,
              },
            ],
          }),
        ),
      ),
    )
    const e = expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'abcde',
      }),
    )
    expect(e.code).toBe('SD_NL_CONFIG_INVALID')
    expect(e.message).toContain('resolução')
    provider.chat.mockResolvedValue(chat(modelEnvelope({ name: 'x' })))
    expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'AUTOMATION',
        text: 'abcde',
      }),
    )
  })

  it('rejects references that do not exist in the workspace', async () => {
    refsCheck.mockResolvedValue(
      err({
        code: 'SD_CONFIG_NOT_FOUND',
        message: 'Prioridade não encontrado(a) nesta workspace',
      } as never),
    )
    const e = expectErr(
      await SdNlConfigService.preview(ACTOR, WS, {
        kind: 'SLA',
        text: 'abcde',
      }),
    )
    expect(e.code).toBe('SD_NL_CONFIG_INVALID')
    expect(e.message).toContain('Prioridade')
  })
})

describe('SdNlConfigService.apply', () => {
  const slaConfig = createFakeSlaConfig() as never
  const autoConfig = createFakeAutomationConfig() as never
  const escConfig = createFakeEscalationConfig() as never

  it.each([
    ['SLA', sla.create, slaConfig],
    ['AUTOMATION', automation.create, autoConfig],
    ['ESCALATION', escalation.create, escConfig],
  ] as const)(
    'creates a %s through its own service',
    async (kind, create, config) => {
      create.mockResolvedValue(saved('c1', 'Criada'))
      const out = expectOk(
        await SdNlConfigService.apply(ACTOR, WS, { kind, config } as never),
      )
      expect(out).toEqual({ kind, mode: 'create', id: 'c1', name: 'Criada' })
      expect(create).toHaveBeenCalledOnce()
      expect(mutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'sd_nl_config',
          action: 'create',
          meta: { kind },
        }),
      )
    },
  )

  it.each([
    ['SLA', sla.update, slaConfig],
    ['AUTOMATION', automation.update, autoConfig],
    ['ESCALATION', escalation.update, escConfig],
  ] as const)(
    'updates a %s when targetId is given',
    async (kind, update, config) => {
      update.mockResolvedValue(saved('t1', 'Atualizada'))
      const out = expectOk(
        await SdNlConfigService.apply(ACTOR, WS, {
          kind,
          targetId: 't1',
          config,
        } as never),
      )
      expect(out.mode).toBe('update')
      expect(update).toHaveBeenCalledWith(ACTOR, WS, 't1', expect.anything())
    },
  )

  it('never sends isDefault=false on an SLA update', async () => {
    sla.update.mockResolvedValue(saved())
    await SdNlConfigService.apply(ACTOR, WS, {
      kind: 'SLA',
      targetId: 't1',
      config: createFakeSlaConfig(),
    } as never)
    expect(sla.update.mock.calls[0][3]).not.toHaveProperty('isDefault')
    await SdNlConfigService.apply(ACTOR, WS, {
      kind: 'SLA',
      targetId: 't1',
      config: createFakeSlaConfig({ isDefault: true }),
    } as never)
    expect(sla.update.mock.calls[1][3]).toHaveProperty('isDefault', true)
  })

  it('propagates admin denial and service errors', async () => {
    mutation.mockResolvedValueOnce(err(forbidden()))
    expect(
      expectErr(
        await SdNlConfigService.apply(ACTOR, WS, {
          kind: 'SLA',
          config: slaConfig,
        } as never),
      ).code,
    ).toBe('FORBIDDEN')
    sla.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SdNlConfigService.apply(ACTOR, WS, {
        kind: 'SLA',
        config: slaConfig,
      } as never),
    )
  })
})
