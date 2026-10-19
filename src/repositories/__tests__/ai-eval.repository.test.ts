import { describe, expect, it, vi } from 'vitest'
import {
  seedAiEvalCase,
  seedAiEvalRun,
  seedAiEvalSet,
} from '@/src/__tests__/factories/ai-quality.factory'
import {
  seedAiConversation,
  seedAiMessage,
} from '@/src/__tests__/factories/steel-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiEvalRepository } from '../ai-eval.repository'

const RESULT = {
  caseId: null,
  input: 'Pergunta',
  output: 'Resposta',
  passed: true,
  checksPassed: true,
  failedChecks: [],
  judgeScore: 0.8,
  judgePassed: true,
  judgeRationale: 'Boa',
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.002,
  error: null,
}

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

describe('AiEvalRepository', () => {
  it('creates, lists, finds, updates and deletes sets', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const created = expectOk(
      await AiEvalRepository.createSet({
        workspaceId: workspace.id,
        name: 'Suporte',
        description: null,
        target: 'STEEL_ASSISTANT',
        skillId: null,
        createdById: user.id,
      }),
    )
    expect(created).toMatchObject({ caseCount: 0, lastRun: null })
    await seedAiEvalSet(workspace.id, { target: 'WHATSAPP_REPLY' })
    await seedAiEvalSet(other.id)

    expect(expectOk(await AiEvalRepository.countSets(workspace.id))).toBe(2)
    expect(
      expectOk(await AiEvalRepository.listSets(workspace.id)).map(
        (s) => s.target,
      ),
    ).toEqual(['STEEL_ASSISTANT', 'WHATSAPP_REPLY'])
    expect(
      expectOk(await AiEvalRepository.listSets(workspace.id, 'WHATSAPP_REPLY')),
    ).toHaveLength(1)

    await seedAiEvalCase(created.id, { position: 1, input: 'B' })
    await seedAiEvalCase(created.id, { position: 0, input: 'A' })
    const run = await seedAiEvalRun(workspace.id, created.id, {
      startedById: user.id,
    })
    const found = expectOk(
      await AiEvalRepository.findSet(created.id, workspace.id),
    )
    expect(found?.cases.map((c) => c.input)).toEqual(['A', 'B'])
    expect(found?.caseCount).toBe(2)
    expect(found?.lastRun?.id).toBe(run.id)
    expect(found?.lastRun?.startedBy?.id).toBe(user.id)
    expect(
      expectOk(await AiEvalRepository.findSet(created.id, other.id)),
    ).toBeNull()

    const updated = expectOk(
      await AiEvalRepository.updateSet(created.id, { name: 'Novo nome' }),
    )
    expect(updated.name).toBe('Novo nome')

    expectOk(await AiEvalRepository.deleteSet(created.id))
    expect(await prisma.aiEvalCase.count()).toBe(0)
    expect(await prisma.aiEvalRun.count()).toBe(0)
  })

  it('appends, finds, updates and deletes cases', async () => {
    const { workspace } = await setup()
    const set = await seedAiEvalSet(workspace.id)
    const data = {
      input: 'Pergunta',
      expected: 'Resposta',
      criteria: null,
      mustContain: ['prazo'],
      mustNotContain: [],
    }
    const first = expectOk(await AiEvalRepository.createCase(set.id, data))
    const second = expectOk(await AiEvalRepository.createCase(set.id, data))
    expect([first.position, second.position]).toEqual([0, 1])
    expect(expectOk(await AiEvalRepository.countCases(set.id))).toBe(2)
    expect(
      expectOk(await AiEvalRepository.findCase(first.id, set.id))?.id,
    ).toBe(first.id)
    expect(expectOk(await AiEvalRepository.findCase(first.id, 'x'))).toBeNull()
    const updated = expectOk(
      await AiEvalRepository.updateCase(first.id, { criteria: 'Citar SLA' }),
    )
    expect(updated.criteria).toBe('Citar SLA')
    expectOk(await AiEvalRepository.deleteCase(first.id))
    expect(expectOk(await AiEvalRepository.countCases(set.id))).toBe(1)
  })

  it('runs: create, claim once, add results, finish, list and find', async () => {
    const { workspace, user } = await setup()
    const set = await seedAiEvalSet(workspace.id)
    await seedAiEvalCase(set.id)
    const run = expectOk(
      await AiEvalRepository.createRun({
        workspaceId: workspace.id,
        setId: set.id,
        modelKey: 'openai:gpt-4o-mini',
        skillId: null,
        promptOverride: null,
        reason: 'model_change',
        startedById: user.id,
        caseCount: 1,
      }),
    )
    expect(expectOk(await AiEvalRepository.findActiveRun(set.id))?.id).toBe(
      run.id,
    )

    const now = new Date('2026-10-18T12:00:00.000Z')
    const claimed = expectOk(await AiEvalRepository.claimRun(run.id, now))
    expect(claimed?.status).toBe('RUNNING')
    expect(claimed?.set.cases).toHaveLength(1)
    expect(expectOk(await AiEvalRepository.claimRun(run.id, now))).toBeNull()

    expectOk(await AiEvalRepository.addResult(run.id, RESULT))
    expectOk(
      await AiEvalRepository.finishRun(run.id, {
        status: 'DONE',
        modelKey: 'openai:gpt-4o-mini',
        judgeModelKey: 'openai:gpt-4o-mini',
        caseCount: 1,
        passedCount: 1,
        failedCount: 0,
        avgScore: 0.8,
        costUsd: 0.002,
        error: null,
        finishedAt: now,
      }),
    )
    expect(expectOk(await AiEvalRepository.findActiveRun(set.id))).toBeNull()

    const detail = expectOk(
      await AiEvalRepository.findRun(run.id, workspace.id),
    )
    expect(detail?.results).toHaveLength(1)
    expect(detail?.status).toBe('DONE')
    expect(expectOk(await AiEvalRepository.findRun(run.id, 'other'))).toBeNull()
    expect(expectOk(await AiEvalRepository.listRuns(set.id, 5))).toHaveLength(1)
  })

  it('finds the last finished run of every set of a target', async () => {
    const { workspace } = await setup()
    const set = await seedAiEvalSet(workspace.id)
    const empty = await seedAiEvalSet(workspace.id)
    await seedAiEvalSet(workspace.id, { target: 'WHATSAPP_REPLY' })
    await seedAiEvalCase(set.id)
    const done = await seedAiEvalRun(workspace.id, set.id, {
      status: 'DONE',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    })
    await seedAiEvalRun(workspace.id, set.id, { status: 'RUNNING' })
    const rows = expectOk(
      await AiEvalRepository.latestDoneByTarget(
        workspace.id,
        'STEEL_ASSISTANT',
      ),
    )
    expect(rows.map((r) => [r.set.id, r.caseCount, r.run?.id ?? null])).toEqual(
      [
        [set.id, 1, done.id],
        [empty.id, 0, null],
      ],
    )
  })

  it('loads the run context of a workspace', async () => {
    const { workspace, user } = await setup()
    expect(
      expectOk(await AiEvalRepository.findRunContext(workspace.id)),
    ).toEqual({
      name: workspace.name,
      modules: [],
      aiEnabled: true,
      whatsappPrompt: null,
    })
    await prisma.workspaceModuleAccess.create({
      data: { workspaceId: workspace.id, module: 'CRM', grantedById: user.id },
    })
    await prisma.workspaceAiSettings.create({
      data: {
        workspaceId: workspace.id,
        enabledModels: [],
        crmAssistantModel: 'openai:gpt-4o-mini',
        whatsappReplyModel: 'openai:gpt-4o-mini',
        whatsappSentimentModel: 'openai:gpt-4o-mini',
        aiEnabled: false,
      },
    })
    await prisma.whatsAppAiConfig.create({
      data: { workspaceId: workspace.id, systemPrompt: 'Seja cordial.' },
    })
    expect(
      expectOk(await AiEvalRepository.findRunContext(workspace.id)),
    ).toEqual({
      name: workspace.name,
      modules: ['CRM'],
      aiEnabled: false,
      whatsappPrompt: 'Seja cordial.',
    })
    expect(expectOk(await AiEvalRepository.findRunContext('nope'))).toBeNull()
  })

  it('finds the question before an assistant answer', async () => {
    const { workspace, user } = await setup()
    const conversation = await seedAiConversation(workspace.id, user.id)
    await seedAiMessage(conversation.id, {
      role: 'USER',
      content: 'Qual o SLA?',
      createdAt: new Date('2026-10-18T10:00:00.000Z'),
    })
    const answer = await seedAiMessage(conversation.id, {
      role: 'ASSISTANT',
      content: 'Quatro horas.',
      createdAt: new Date('2026-10-18T10:00:05.000Z'),
    })
    const lonely = await seedAiConversation(workspace.id, user.id)
    const orphan = await seedAiMessage(lonely.id, {
      role: 'ASSISTANT',
      content: 'Oi',
    })
    expect(
      expectOk(await AiEvalRepository.findSourceTurn(answer.id, workspace.id)),
    ).toEqual({
      question: 'Qual o SLA?',
      answer: 'Quatro horas.',
      conversationUserId: user.id,
    })
    expect(
      expectOk(await AiEvalRepository.findSourceTurn(orphan.id, workspace.id))
        ?.question,
    ).toBeNull()
    expect(
      expectOk(await AiEvalRepository.findSourceTurn(answer.id, 'other')),
    ).toBeNull()
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    const boom = (() => Promise.reject(new Error('boom'))) as never
    for (const model of [
      prisma.aiEvalSet,
      prisma.aiEvalCase,
      prisma.aiEvalRun,
      prisma.aiEvalResult,
    ] as unknown as Record<string, unknown>[]) {
      for (const method of [
        'count',
        'findMany',
        'findFirst',
        'findUnique',
        'create',
        'update',
        'updateMany',
        'deleteMany',
        'aggregate',
      ]) {
        if (typeof model[method] === 'function') {
          const spyOn = vi.spyOn as unknown as (
            target: unknown,
            name: string,
          ) => { mockImplementation: (impl: never) => void }
          spyOn(model, method).mockImplementation(boom)
        }
      }
    }
    vi.spyOn(prisma.workspace, 'findUnique').mockImplementation(boom)
    vi.spyOn(prisma.aiMessage, 'findFirst').mockImplementation(boom)

    const caseData = {
      input: 'a',
      expected: null,
      criteria: null,
      mustContain: [],
      mustNotContain: [],
    }
    const results = [
      await AiEvalRepository.countSets('w'),
      await AiEvalRepository.listSets('w'),
      await AiEvalRepository.findSet('s', 'w'),
      await AiEvalRepository.createSet({
        workspaceId: 'w',
        name: 'n',
        description: null,
        target: 'STEEL_ASSISTANT',
        skillId: null,
        createdById: 'u',
      }),
      await AiEvalRepository.updateSet('s', { name: 'n' }),
      await AiEvalRepository.deleteSet('s'),
      await AiEvalRepository.countCases('s'),
      await AiEvalRepository.createCase('s', caseData),
      await AiEvalRepository.findCase('c', 's'),
      await AiEvalRepository.updateCase('c', { input: 'b' }),
      await AiEvalRepository.deleteCase('c'),
      await AiEvalRepository.findActiveRun('s'),
      await AiEvalRepository.createRun({
        workspaceId: 'w',
        setId: 's',
        modelKey: null,
        skillId: null,
        promptOverride: null,
        reason: 'manual',
        startedById: 'u',
        caseCount: 1,
      }),
      await AiEvalRepository.listRuns('s', 1),
      await AiEvalRepository.findRun('r', 'w'),
      await AiEvalRepository.claimRun('r', new Date()),
      await AiEvalRepository.addResult('r', RESULT),
      await AiEvalRepository.finishRun('r', {
        status: 'FAILED',
        modelKey: null,
        judgeModelKey: null,
        caseCount: 0,
        passedCount: 0,
        failedCount: 0,
        avgScore: null,
        costUsd: 0,
        error: 'x',
        finishedAt: new Date(),
      }),
      await AiEvalRepository.latestDoneByTarget('w', 'STEEL_ASSISTANT'),
      await AiEvalRepository.findRunContext('w'),
      await AiEvalRepository.findSourceTurn('m', 'w'),
    ]
    for (const result of results) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    vi.restoreAllMocks()
  })
})
