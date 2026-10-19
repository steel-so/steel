import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeAiEvalCase,
  createFakeAiEvalClaimedRun,
  createFakeAiEvalResult,
  createFakeAiEvalRun,
} from '@/src/__tests__/factories/ai-quality.factory'
import { createFakeAiSkill } from '@/src/__tests__/factories/ai-skill-memory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { aiQuotaExceeded, aiSkillNotFound } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/ai-eval.repository')
vi.mock('@/src/repositories/ai-skill.repository')
vi.mock('@/src/services/ai-usage.service', () => ({
  AiUsageService: { prepare: vi.fn(), record: vi.fn(), price: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-ai-reply.service', () => ({
  WHATSAPP_AI_HANDOFF_MARKER: '[[TRANSFERIR_ATENDENTE]]',
  buildWhatsAppAiReplySystem: vi.fn(),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { AiEvalRepository } from '@/src/repositories/ai-eval.repository'
import { AiSkillRepository } from '@/src/repositories/ai-skill.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { buildWhatsAppAiReplySystem } from '@/src/services/whatsapp-ai-reply.service'
import { executeAiEvalRun } from '../ai-eval-runner'

const repo = vi.mocked(AiEvalRepository)
const skills = vi.mocked(AiSkillRepository)
const usage = vi.mocked(AiUsageService)
const waSystem = vi.mocked(buildWhatsAppAiReplySystem)
const audit = vi.mocked(auditMutation)

const NOW = new Date('2026-10-18T12:00:00.000Z')
const clock = () => NOW
const chat = vi.fn()

function prepared(key = 'openai:gpt-4o-mini') {
  return {
    feature: 'AI_EVAL',
    provider: { id: 'openai', chat, chatStream: vi.fn() },
    model: { key, model: key.split(':')[1], provider: 'openai' },
    costMargin: 1,
  }
}

function reply(text: string) {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 100, outputTokens: 20 },
    stopReason: 'end',
  }
}

const CONTEXT = {
  name: 'Acme',
  modules: ['CRM' as const],
  aiEnabled: true,
  whatsappPrompt: 'Seja cordial.',
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findRunContext.mockResolvedValue(ok(CONTEXT))
  repo.addResult.mockResolvedValue(ok(createFakeAiEvalResult()))
  repo.finishRun.mockResolvedValue(ok(createFakeAiEvalRun()))
  usage.prepare.mockResolvedValue(ok(prepared()) as never)
  usage.record.mockResolvedValue(undefined)
  usage.price.mockReturnValue(0.01)
  waSystem.mockResolvedValue('PROMPT DO WHATSAPP')
})

describe('executeAiEvalRun', () => {
  it('skips a run that is not queued anymore', async () => {
    repo.claimRun.mockResolvedValueOnce(ok(null))
    expect(expectOk(await executeAiEvalRun('r1', clock))).toEqual({
      status: 'skipped',
      reason: 'not_queued',
    })
  })

  it('propagates a claim failure', async () => {
    repo.claimRun.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await executeAiEvalRun('r1', clock), 'DATABASE_ERROR')
  })

  it('answers, checks and judges every case of a Steel AI set', async () => {
    const cases = [
      createFakeAiEvalCase({
        id: 'c1',
        expected: 'Quatro horas',
        mustContain: ['quatro'],
      }),
      createFakeAiEvalCase({
        id: 'c2',
        expected: null,
        criteria: null,
        mustNotContain: ['senha'],
      }),
    ]
    repo.claimRun.mockResolvedValueOnce(
      ok(
        createFakeAiEvalClaimedRun(
          { id: 'r1', modelKey: 'anthropic:claude-sonnet-5' },
          { skillId: 'sk_1' },
          cases,
        ),
      ),
    )
    skills.findById.mockResolvedValueOnce(
      ok(
        createFakeAiSkill({
          slug: 'sla',
          name: 'SLA',
          instructions: 'Cite o SLA.',
        }),
      ),
    )
    usage.prepare.mockImplementation(
      async (_ws, _f, userId) =>
        ok(
          prepared(
            userId === null
              ? 'openai:gpt-4o-mini'
              : 'anthropic:claude-sonnet-5',
          ),
        ) as never,
    )
    chat
      .mockResolvedValueOnce(reply('São quatro horas.'))
      .mockResolvedValueOnce(reply('{"score":0.9,"rationale":"Correta"}'))
      .mockResolvedValueOnce(reply('Informe a sua SENHA.'))

    expect(expectOk(await executeAiEvalRun('r1', clock))).toEqual({
      status: 'done',
      passed: 1,
      failed: 1,
    })
    const system = chat.mock.calls[0][0].system as string
    expect(system).toContain('Workspace: Acme')
    expect(system).toContain('/sla (SLA)')
    expect(system).toContain('Avaliação automática')
    expect(chat.mock.calls[1][0].jsonSchema).toBeDefined()

    expect(repo.addResult).toHaveBeenNthCalledWith(
      1,
      'r1',
      expect.objectContaining({
        caseId: 'c1',
        passed: true,
        judgeScore: 0.9,
        judgePassed: true,
        judgeRationale: 'Correta',
        inputTokens: 200,
        costUsd: 0.02,
      }),
    )
    expect(repo.addResult).toHaveBeenNthCalledWith(
      2,
      'r1',
      expect.objectContaining({
        caseId: 'c2',
        passed: false,
        checksPassed: false,
        failedChecks: ['Não deveria conter "senha"'],
        judgePassed: null,
      }),
    )
    expect(repo.finishRun).toHaveBeenCalledWith('r1', {
      status: 'DONE',
      modelKey: 'anthropic:claude-sonnet-5',
      judgeModelKey: 'openai:gpt-4o-mini',
      caseCount: 2,
      passedCount: 1,
      failedCount: 1,
      avgScore: 0.9,
      costUsd: 0.03,
      error: null,
      finishedAt: NOW,
    })
    expect(usage.record).toHaveBeenCalledTimes(3)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'ai_eval_run', action: 'update' }),
    )
  })

  it('answers a WhatsApp set with the draft prompt and strips the handoff marker', async () => {
    repo.claimRun.mockResolvedValueOnce(
      ok(
        createFakeAiEvalClaimedRun(
          { promptOverride: 'Rascunho' },
          { target: 'WHATSAPP_REPLY' },
          [
            createFakeAiEvalCase({
              expected: null,
              mustContain: ['atendente'],
            }),
          ],
        ),
      ),
    )
    chat.mockResolvedValueOnce(
      reply('Vou chamar um atendente. [[TRANSFERIR_ATENDENTE]]'),
    )
    expectOk(await executeAiEvalRun('r1', clock))
    expect(waSystem).toHaveBeenCalledWith(expect.any(String), 'Rascunho')
    expect(chat.mock.calls[0][0].system).toBe('PROMPT DO WHATSAPP')
    expect(repo.addResult).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        output: 'Vou chamar um atendente.',
        passed: true,
      }),
    )
  })

  it('falls back to the saved WhatsApp prompt, or none', async () => {
    const whatsapp = () =>
      createFakeAiEvalClaimedRun({}, { target: 'WHATSAPP_REPLY' }, [
        createFakeAiEvalCase({ expected: null, mustContain: ['x'] }),
      ])
    chat.mockResolvedValue(reply('x'))
    repo.claimRun.mockResolvedValueOnce(ok(whatsapp()))
    expectOk(await executeAiEvalRun('r1', clock))
    expect(waSystem).toHaveBeenLastCalledWith(
      expect.any(String),
      'Seja cordial.',
    )
    repo.claimRun.mockResolvedValueOnce(ok(whatsapp()))
    repo.findRunContext.mockResolvedValueOnce(
      ok({ ...CONTEXT, whatsappPrompt: null }),
    )
    expectOk(await executeAiEvalRun('r1', clock))
    expect(waSystem).toHaveBeenLastCalledWith(expect.any(String), '')
  })

  it('records a case the provider did not answer', async () => {
    repo.claimRun.mockResolvedValueOnce(ok(createFakeAiEvalClaimedRun()))
    chat.mockRejectedValueOnce(new Error('timeout'))
    expect(expectOk(await executeAiEvalRun('r1', clock))).toEqual({
      status: 'done',
      passed: 0,
      failed: 1,
    })
    expect(repo.addResult).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        output: '',
        passed: false,
        error: 'O provedor de IA não respondeu a este caso.',
      }),
    )
  })

  it('fails the case when the judge is unusable', async () => {
    repo.claimRun.mockResolvedValueOnce(ok(createFakeAiEvalClaimedRun()))
    chat
      .mockResolvedValueOnce(reply('Quatro horas.'))
      .mockResolvedValueOnce(reply('nota: boa'))
    expectOk(await executeAiEvalRun('r1', clock))
    expect(repo.addResult).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        passed: false,
        judgeScore: null,
        judgePassed: false,
        error: 'O juiz não devolveu uma nota válida para este caso.',
      }),
    )

    repo.claimRun.mockResolvedValueOnce(ok(createFakeAiEvalClaimedRun()))
    chat
      .mockResolvedValueOnce(reply('Quatro horas.'))
      .mockRejectedValueOnce('judge down')
    expectOk(await executeAiEvalRun('r1', clock))
    expect(repo.addResult).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ passed: false, judgeScore: null }),
    )
  })

  it('keeps an empty rationale as null', async () => {
    repo.claimRun.mockResolvedValueOnce(ok(createFakeAiEvalClaimedRun()))
    chat
      .mockResolvedValueOnce(reply('Quatro horas.'))
      .mockResolvedValueOnce(reply('{"score":0.8,"rationale":""}'))
    expectOk(await executeAiEvalRun('r1', clock))
    expect(repo.addResult).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ judgeRationale: null, passed: true }),
    )
  })

  it.each([
    [
      'the workspace is gone',
      () => repo.findRunContext.mockResolvedValueOnce(ok(null)),
      'Workspace não encontrado.',
    ],
    [
      'AI is off',
      () =>
        repo.findRunContext.mockResolvedValueOnce(
          ok({ ...CONTEXT, aiEnabled: false }),
        ),
      'A IA está desligada neste workspace.',
    ],
    [
      'the skill is gone',
      () => skills.findById.mockResolvedValueOnce(err(aiSkillNotFound())),
      'Skill não encontrada',
    ],
  ])('fails the run when %s', async (_label, arrange, message) => {
    repo.claimRun.mockResolvedValueOnce(
      ok(createFakeAiEvalClaimedRun({ skillId: 'sk_1' })),
    )
    arrange()
    expect(expectOk(await executeAiEvalRun('r1', clock))).toEqual({
      status: 'failed',
      error: message,
    })
    expect(repo.finishRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'FAILED', error: message }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel' }),
    )
  })

  it('fails a run with no cases', async () => {
    repo.claimRun.mockResolvedValueOnce(
      ok(createFakeAiEvalClaimedRun({}, {}, [])),
    )
    expect(expectOk(await executeAiEvalRun('r1', clock))).toEqual({
      status: 'failed',
      error: 'O conjunto não tem casos de teste.',
    })
  })

  it('stops when the quota runs out, keeping the graded cases', async () => {
    repo.claimRun.mockResolvedValueOnce(
      ok(
        createFakeAiEvalClaimedRun({}, {}, [
          createFakeAiEvalCase({ expected: null, mustContain: ['a'] }),
          createFakeAiEvalCase({ expected: null, mustContain: ['b'] }),
        ]),
      ),
    )
    chat.mockResolvedValueOnce(reply('a'))
    usage.prepare
      .mockResolvedValueOnce(ok(prepared()) as never)
      .mockResolvedValueOnce(err(aiQuotaExceeded(50, 50)) as never)
    const outcome = expectOk(await executeAiEvalRun('r1', clock))
    expect(outcome.status).toBe('failed')
    expect(repo.finishRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'FAILED',
        passedCount: 1,
        modelKey: 'openai:gpt-4o-mini',
      }),
    )
  })

  it('fails when the judge cannot be prepared', async () => {
    repo.claimRun.mockResolvedValueOnce(ok(createFakeAiEvalClaimedRun()))
    usage.prepare
      .mockResolvedValueOnce(ok(prepared()) as never)
      .mockResolvedValueOnce(err(aiQuotaExceeded(50, 50)) as never)
    expect(expectOk(await executeAiEvalRun('r1', clock)).status).toBe('failed')
  })

  it('fails when a result cannot be saved', async () => {
    repo.claimRun.mockResolvedValueOnce(
      ok(
        createFakeAiEvalClaimedRun({}, {}, [
          createFakeAiEvalCase({ expected: null, mustContain: ['a'] }),
        ]),
      ),
    )
    chat.mockResolvedValueOnce(reply('a'))
    repo.addResult.mockResolvedValueOnce(err(databaseError('x')))
    expect(expectOk(await executeAiEvalRun('r1', clock))).toEqual({
      status: 'failed',
      error: 'Não foi possível salvar o resultado.',
    })
  })

  it('propagates context and finish failures', async () => {
    repo.claimRun.mockResolvedValueOnce(ok(createFakeAiEvalClaimedRun()))
    repo.findRunContext.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await executeAiEvalRun('r1', clock), 'DATABASE_ERROR')

    repo.claimRun.mockResolvedValueOnce(
      ok(createFakeAiEvalClaimedRun({}, {}, [])),
    )
    repo.finishRun.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await executeAiEvalRun('r1', clock), 'DATABASE_ERROR')
  })

  it('uses the real clock by default', async () => {
    repo.claimRun.mockResolvedValueOnce(ok(null))
    expectOk(await executeAiEvalRun('r1'))
    expect(repo.claimRun).toHaveBeenCalledWith('r1', expect.any(Date))
  })
})
