import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeAiEvalCase,
  createFakeAiEvalRun,
  createFakeAiEvalRunWithResults,
  createFakeAiEvalRunWithUser,
  createFakeAiEvalSet,
  createFakeAiEvalSetSummary,
  createFakeAiEvalSetWithCases,
} from '@/src/__tests__/factories/ai-quality.factory'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeAiSkill } from '@/src/__tests__/factories/ai-skill-memory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { aiSkillNotFound } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/ai-eval.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/ai-skill.repository')
vi.mock('@/src/services/authz', () => ({ assertMember: vi.fn() }))
vi.mock('@/src/services/ai-settings.service', () => ({
  isModelUsable: vi.fn(),
}))
vi.mock('@/src/lib/queue/queues', () => ({ getAiEvalQueue: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { getAiEvalQueue } from '@/src/lib/queue/queues'
import { AiEvalRepository } from '@/src/repositories/ai-eval.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { AiSkillRepository } from '@/src/repositories/ai-skill.repository'
import type { StartAiEvalRunInput } from '@/src/schemas/ai-eval.schema'
import { isModelUsable } from '@/src/services/ai-settings.service'
import { assertMember } from '@/src/services/authz'
import { AI_EVAL_RUN_HISTORY, AiEvalService } from '../ai-eval.service'

const repo = vi.mocked(AiEvalRepository)
const settingsRepo = vi.mocked(WorkspaceAiSettingsRepository)
const skills = vi.mocked(AiSkillRepository)
const member = vi.mocked(assertMember)
const usable = vi.mocked(isModelUsable)
const queue = { add: vi.fn() }
const audit = vi.mocked(auditMutation)

const ACTOR = 'user_1'
const WS = 'ws_1'
const SET = 'set_1'

function asRole(isPrivileged: boolean) {
  member.mockResolvedValue(
    ok({
      role: isPrivileged ? 'ADMIN' : 'MEMBER',
      isPrivileged,
      permissions: null,
    }) as never,
  )
}

const CASE = {
  input: 'Pergunta',
  expected: 'Resposta',
  criteria: null,
  mustContain: [],
  mustNotContain: [],
}

function runInput(
  over: Partial<StartAiEvalRunInput> = {},
): StartAiEvalRunInput {
  return {
    modelKey: null,
    skillId: null,
    promptOverride: null,
    reason: 'manual',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole(true)
  vi.mocked(getAiEvalQueue).mockReturnValue(queue as never)
  queue.add.mockResolvedValue({})
  repo.findSet.mockResolvedValue(
    ok(
      createFakeAiEvalSetWithCases({ id: SET, workspaceId: WS, caseCount: 2 }),
    ),
  )
  repo.countSets.mockResolvedValue(ok(0))
  repo.findActiveRun.mockResolvedValue(ok(null))
  repo.createRun.mockResolvedValue(
    ok(createFakeAiEvalRunWithUser({ id: 'run_1', setId: SET })),
  )
  repo.finishRun.mockResolvedValue(ok(createFakeAiEvalRun()))
  settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
  usable.mockReturnValue(true)
  skills.findById.mockResolvedValue(
    ok(createFakeAiSkill({ id: 'sk_1', scope: 'WORKSPACE', ownerId: null })),
  )
})

describe('AiEvalService — admins only', () => {
  it.each([
    ['listSets', () => AiEvalService.listSets(ACTOR, WS)],
    ['getSet', () => AiEvalService.getSet(ACTOR, WS, SET)],
    [
      'createSet',
      () =>
        AiEvalService.createSet(ACTOR, WS, {
          name: 'n',
          description: null,
          target: 'STEEL_ASSISTANT',
          skillId: null,
        }),
    ],
    [
      'caseFromMessage',
      () =>
        AiEvalService.caseFromMessage(ACTOR, WS, {
          setId: SET,
          messageId: 'm',
          criteria: null,
        }),
    ],
    ['getRun', () => AiEvalService.getRun(ACTOR, WS, SET, 'r')],
    ['latest', () => AiEvalService.latest(ACTOR, WS, 'STEEL_ASSISTANT')],
  ])('%s denies members', async (_name, call) => {
    asRole(false)
    expectErr(await call(), 'FORBIDDEN')
  })

  it('denies non-members', async () => {
    member.mockResolvedValueOnce(err(forbidden()) as never)
    expectErr(await AiEvalService.listSets(ACTOR, WS), 'FORBIDDEN')
  })
})

describe('sets', () => {
  it('lists and gets sets', async () => {
    repo.listSets.mockResolvedValueOnce(ok([createFakeAiEvalSetSummary()]))
    expect(expectOk(await AiEvalService.listSets(ACTOR, WS))).toHaveLength(1)
    expect(expectOk(await AiEvalService.getSet(ACTOR, WS, SET)).id).toBe(SET)
    repo.listSets.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiEvalService.listSets(ACTOR, WS), 'DATABASE_ERROR')
  })

  it('reports a missing set and propagates errors', async () => {
    repo.findSet.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.getSet(ACTOR, WS, SET),
      'AI_EVAL_SET_NOT_FOUND',
    )
    repo.findSet.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiEvalService.getSet(ACTOR, WS, SET), 'DATABASE_ERROR')
  })

  it('creates a set with a workspace skill and audits', async () => {
    repo.createSet.mockResolvedValueOnce(ok(createFakeAiEvalSetSummary()))
    expectOk(
      await AiEvalService.createSet(ACTOR, WS, {
        name: 'Suporte',
        description: null,
        target: 'STEEL_ASSISTANT',
        skillId: 'sk_1',
      }),
    )
    expect(repo.createSet).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: ACTOR, skillId: 'sk_1' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'ai_eval_set', action: 'create' }),
    )
  })

  it('caps the sets per workspace', async () => {
    repo.countSets.mockResolvedValueOnce(ok(20))
    expectErr(
      await AiEvalService.createSet(ACTOR, WS, {
        name: 'n',
        description: null,
        target: 'STEEL_ASSISTANT',
        skillId: null,
      }),
      'AI_EVAL_LIMIT_REACHED',
    )
    repo.countSets.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.createSet(ACTOR, WS, {
        name: 'n',
        description: null,
        target: 'STEEL_ASSISTANT',
        skillId: null,
      }),
      'DATABASE_ERROR',
    )
  })

  it('validates the skill of a set', async () => {
    const input = {
      name: 'n',
      description: null,
      target: 'WHATSAPP_REPLY' as const,
      skillId: 'sk_1',
    }
    expectErr(
      await AiEvalService.createSet(ACTOR, WS, input),
      'VALIDATION_ERROR',
    )
    skills.findById.mockResolvedValueOnce(
      ok(createFakeAiSkill({ scope: 'PERSONAL', ownerId: 'someone' })),
    )
    expectErr(
      await AiEvalService.createSet(ACTOR, WS, {
        ...input,
        target: 'STEEL_ASSISTANT',
      }),
      'VALIDATION_ERROR',
    )
    skills.findById.mockResolvedValueOnce(err(aiSkillNotFound()))
    expectErr(
      await AiEvalService.createSet(ACTOR, WS, {
        ...input,
        target: 'STEEL_ASSISTANT',
      }),
      'AI_SKILL_NOT_FOUND',
    )
    skills.findById.mockResolvedValueOnce(
      ok(createFakeAiSkill({ scope: 'PERSONAL', ownerId: ACTOR })),
    )
    repo.createSet.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.createSet(ACTOR, WS, {
        ...input,
        target: 'STEEL_ASSISTANT',
      }),
      'DATABASE_ERROR',
    )
  })

  it('updates a set (checking a new skill) and deletes it', async () => {
    repo.updateSet.mockResolvedValue(ok(createFakeAiEvalSetSummary()))
    expectOk(await AiEvalService.updateSet(ACTOR, WS, SET, { name: 'x' }))
    expect(skills.findById).not.toHaveBeenCalled()
    expectOk(await AiEvalService.updateSet(ACTOR, WS, SET, { skillId: 'sk_1' }))
    expect(skills.findById).toHaveBeenCalled()
    skills.findById.mockResolvedValueOnce(err(aiSkillNotFound()))
    expectErr(
      await AiEvalService.updateSet(ACTOR, WS, SET, { skillId: 'sk_2' }),
      'AI_SKILL_NOT_FOUND',
    )
    repo.findSet.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.updateSet(ACTOR, WS, SET, { name: 'x' }),
      'AI_EVAL_SET_NOT_FOUND',
    )
    repo.updateSet.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.updateSet(ACTOR, WS, SET, { name: 'x' }),
      'DATABASE_ERROR',
    )

    repo.deleteSet.mockResolvedValueOnce(ok(undefined))
    expectOk(await AiEvalService.deleteSet(ACTOR, WS, SET))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'ai_eval_set', action: 'delete' }),
    )
    repo.deleteSet.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiEvalService.deleteSet(ACTOR, WS, SET), 'DATABASE_ERROR')
    repo.findSet.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.deleteSet(ACTOR, WS, SET),
      'AI_EVAL_SET_NOT_FOUND',
    )
  })
})

describe('cases', () => {
  it('adds a case and caps the cases per set', async () => {
    repo.createCase.mockResolvedValueOnce(ok(createFakeAiEvalCase()))
    expectOk(await AiEvalService.addCase(ACTOR, WS, SET, CASE))
    expect(repo.createCase).toHaveBeenCalledWith(
      SET,
      expect.objectContaining({ sourceMessageId: null }),
    )
    repo.findSet.mockResolvedValueOnce(
      ok(createFakeAiEvalSetWithCases({ caseCount: 50 })),
    )
    expectErr(
      await AiEvalService.addCase(ACTOR, WS, SET, CASE),
      'AI_EVAL_LIMIT_REACHED',
    )
    repo.findSet.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.addCase(ACTOR, WS, SET, CASE),
      'AI_EVAL_SET_NOT_FOUND',
    )
    repo.createCase.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.addCase(ACTOR, WS, SET, CASE),
      'DATABASE_ERROR',
    )
  })

  it('updates a case keeping a grading', async () => {
    const existing = createFakeAiEvalCase({ id: 'c1', setId: SET })
    repo.findCase.mockResolvedValue(ok(existing))
    repo.updateCase.mockResolvedValue(ok(existing))
    expectOk(
      await AiEvalService.updateCase(ACTOR, WS, SET, 'c1', { input: 'Nova' }),
    )
    expectErr(
      await AiEvalService.updateCase(ACTOR, WS, SET, 'c1', { expected: null }),
      'VALIDATION_ERROR',
    )
    repo.findCase.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.updateCase(ACTOR, WS, SET, 'c1', { input: 'x' }),
      'AI_EVAL_CASE_NOT_FOUND',
    )
    repo.findCase.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.updateCase(ACTOR, WS, SET, 'c1', { input: 'x' }),
      'DATABASE_ERROR',
    )
    repo.updateCase.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.updateCase(ACTOR, WS, SET, 'c1', { input: 'x' }),
      'DATABASE_ERROR',
    )
    repo.findSet.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.updateCase(ACTOR, WS, SET, 'c1', { input: 'x' }),
      'AI_EVAL_SET_NOT_FOUND',
    )
  })

  it('deletes a case', async () => {
    repo.findCase.mockResolvedValue(ok(createFakeAiEvalCase({ id: 'c1' })))
    repo.deleteCase.mockResolvedValue(ok(undefined))
    expectOk(await AiEvalService.deleteCase(ACTOR, WS, SET, 'c1'))
    repo.findCase.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.deleteCase(ACTOR, WS, SET, 'c1'),
      'AI_EVAL_CASE_NOT_FOUND',
    )
    repo.findCase.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.deleteCase(ACTOR, WS, SET, 'c1'),
      'DATABASE_ERROR',
    )
    repo.deleteCase.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.deleteCase(ACTOR, WS, SET, 'c1'),
      'DATABASE_ERROR',
    )
    repo.findSet.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.deleteCase(ACTOR, WS, SET, 'c1'),
      'AI_EVAL_SET_NOT_FOUND',
    )
  })

  it('saves a chat turn as a case (own conversations only)', async () => {
    repo.findSourceTurn.mockResolvedValueOnce(
      ok({
        question: '  Qual o SLA?  ',
        answer: ' Quatro horas. ',
        conversationUserId: ACTOR,
      }),
    )
    repo.createCase.mockResolvedValueOnce(ok(createFakeAiEvalCase()))
    expectOk(
      await AiEvalService.caseFromMessage(ACTOR, WS, {
        setId: SET,
        messageId: 'm1',
        criteria: 'Citar o prazo',
      }),
    )
    expect(repo.createCase).toHaveBeenCalledWith(SET, {
      input: 'Qual o SLA?',
      expected: 'Quatro horas.',
      criteria: 'Citar o prazo',
      mustContain: [],
      mustNotContain: [],
      sourceMessageId: 'm1',
    })

    const input = { setId: SET, messageId: 'm1', criteria: null }
    repo.findSourceTurn.mockResolvedValueOnce(
      ok({ question: 'Q', answer: 'A', conversationUserId: 'someone' }),
    )
    expectErr(
      await AiEvalService.caseFromMessage(ACTOR, WS, input),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
    repo.findSourceTurn.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.caseFromMessage(ACTOR, WS, input),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
    repo.findSourceTurn.mockResolvedValueOnce(
      ok({ question: null, answer: 'A', conversationUserId: ACTOR }),
    )
    expectErr(
      await AiEvalService.caseFromMessage(ACTOR, WS, input),
      'VALIDATION_ERROR',
    )
    repo.findSourceTurn.mockResolvedValueOnce(
      ok({ question: 'Q', answer: '  ', conversationUserId: ACTOR }),
    )
    expectErr(
      await AiEvalService.caseFromMessage(ACTOR, WS, input),
      'VALIDATION_ERROR',
    )
    repo.findSourceTurn.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.caseFromMessage(ACTOR, WS, input),
      'DATABASE_ERROR',
    )
  })
})

describe('runs', () => {
  it('refuses to run a Steel Agent gate set by hand', async () => {
    repo.findSet.mockResolvedValueOnce(
      ok(
        createFakeAiEvalSetWithCases({
          id: SET,
          workspaceId: WS,
          caseCount: 2,
          target: 'STEEL_AGENT',
        }),
      ),
    )
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'VALIDATION_ERROR',
    )
    expect(repo.createRun).not.toHaveBeenCalled()
  })

  it('queues a run with a candidate model and audits', async () => {
    const run = expectOk(
      await AiEvalService.startRun(
        ACTOR,
        WS,
        SET,
        runInput({
          modelKey: 'anthropic:claude-sonnet-5',
          reason: 'model_change',
        }),
      ),
    )
    expect(run.id).toBe('run_1')
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        modelKey: 'anthropic:claude-sonnet-5',
        caseCount: 2,
        startedById: ACTOR,
      }),
    )
    expect(queue.add).toHaveBeenCalledWith(
      'run',
      { runId: 'run_1' },
      { jobId: 'ai-eval-run_1' },
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'ai_eval_run', action: 'start' }),
    )
  })

  it('refuses empty sets, busy sets, disabled AI and unusable models', async () => {
    repo.findSet.mockResolvedValueOnce(
      ok(createFakeAiEvalSetWithCases({ caseCount: 0 })),
    )
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'AI_EVAL_SET_EMPTY',
    )
    repo.findActiveRun.mockResolvedValueOnce(ok(createFakeAiEvalRun()))
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'AI_EVAL_RUN_IN_PROGRESS',
    )
    settingsRepo.findByWorkspace.mockResolvedValueOnce(
      ok(createFakeWorkspaceAiSettings({ aiEnabled: false })),
    )
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'AI_DISABLED',
    )
    usable.mockReturnValueOnce(false)
    expectErr(
      await AiEvalService.startRun(
        ACTOR,
        WS,
        SET,
        runInput({ modelKey: 'openai:gpt-5' }),
      ),
      'AI_MODEL_NOT_ENABLED',
    )
    expect(repo.createRun).not.toHaveBeenCalled()
  })

  it('takes a draft prompt only for WhatsApp sets', async () => {
    expectErr(
      await AiEvalService.startRun(
        ACTOR,
        WS,
        SET,
        runInput({ promptOverride: 'Seja breve' }),
      ),
      'VALIDATION_ERROR',
    )
    repo.findSet.mockResolvedValueOnce(
      ok(
        createFakeAiEvalSetWithCases({
          target: 'WHATSAPP_REPLY',
          caseCount: 1,
        }),
      ),
    )
    expectOk(
      await AiEvalService.startRun(
        ACTOR,
        WS,
        SET,
        runInput({ promptOverride: 'Seja breve', reason: 'prompt_change' }),
      ),
    )
  })

  it('checks a draft skill', async () => {
    skills.findById.mockResolvedValueOnce(err(aiSkillNotFound()))
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput({ skillId: 'x' })),
      'AI_SKILL_NOT_FOUND',
    )
  })

  it('marks the run as failed when the queue is down', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis down'))
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'INTERNAL_SERVER_ERROR',
    )
    expect(repo.finishRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'FAILED' }),
    )
    queue.add.mockRejectedValueOnce('weird')
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'INTERNAL_SERVER_ERROR',
    )
  })

  it('propagates database errors while starting', async () => {
    repo.findSet.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'DATABASE_ERROR',
    )
    settingsRepo.findByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'DATABASE_ERROR',
    )
    repo.findActiveRun.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'DATABASE_ERROR',
    )
    repo.createRun.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.startRun(ACTOR, WS, SET, runInput()),
      'DATABASE_ERROR',
    )
  })

  it('lists runs and gets one of the set', async () => {
    repo.listRuns.mockResolvedValueOnce(ok([createFakeAiEvalRunWithUser()]))
    expect(expectOk(await AiEvalService.listRuns(ACTOR, WS, SET))).toHaveLength(
      1,
    )
    expect(repo.listRuns).toHaveBeenCalledWith(SET, AI_EVAL_RUN_HISTORY)
    repo.listRuns.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiEvalService.listRuns(ACTOR, WS, SET), 'DATABASE_ERROR')
    repo.findSet.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.listRuns(ACTOR, WS, SET),
      'AI_EVAL_SET_NOT_FOUND',
    )

    repo.findRun.mockResolvedValueOnce(
      ok(createFakeAiEvalRunWithResults({ id: 'r1', setId: SET })),
    )
    expect(expectOk(await AiEvalService.getRun(ACTOR, WS, SET, 'r1')).id).toBe(
      'r1',
    )
    repo.findRun.mockResolvedValueOnce(
      ok(createFakeAiEvalRunWithResults({ setId: 'other' })),
    )
    expectErr(
      await AiEvalService.getRun(ACTOR, WS, SET, 'r1'),
      'AI_EVAL_RUN_NOT_FOUND',
    )
    repo.findRun.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiEvalService.getRun(ACTOR, WS, SET, 'r1'),
      'AI_EVAL_RUN_NOT_FOUND',
    )
    repo.findRun.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.getRun(ACTOR, WS, SET, 'r1'),
      'DATABASE_ERROR',
    )
  })

  it('lists the last finished run of every set of a target', async () => {
    repo.latestDoneByTarget.mockResolvedValueOnce(
      ok([
        {
          set: createFakeAiEvalSet({ id: 's1' }),
          caseCount: 3,
          run: createFakeAiEvalRunWithUser({ status: 'DONE', caseCount: 3 }),
        },
        { set: createFakeAiEvalSet({ id: 's2' }), caseCount: 0, run: null },
      ]),
    )
    const sets = expectOk(
      await AiEvalService.latest(ACTOR, WS, 'STEEL_ASSISTANT'),
    )
    expect(
      sets.map((s) => [s.id, s.caseCount, s.lastRun?.status ?? null]),
    ).toEqual([
      ['s1', 3, 'DONE'],
      ['s2', 0, null],
    ])
    repo.latestDoneByTarget.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiEvalService.latest(ACTOR, WS, 'STEEL_ASSISTANT'),
      'DATABASE_ERROR',
    )
  })
})
