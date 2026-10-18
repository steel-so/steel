import type { AiEvalCase, AiSkill, ModuleKind } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  AI_EVAL_JUDGE_SYSTEM,
  averageScore,
  buildJudgePrompt,
  caseVerdict,
  needsJudge,
  parseJudgeOutput,
  runTextChecks,
} from '@/src/lib/ai/eval-grading'
import { buildSteelAiSystemPrompt } from '@/src/lib/ai/steel-ai-prompt'
import type { AiUsageTokens } from '@/src/lib/ai/types'
import { ok, type Result } from '@/src/lib/result'
import {
  type AiEvalClaimedRun,
  AiEvalRepository,
  type AiEvalResultData,
} from '@/src/repositories/ai-eval.repository'
import { AiSkillRepository } from '@/src/repositories/ai-skill.repository'
import { AI_EVAL_JUDGE_JSON_SCHEMA } from '@/src/schemas/ai-eval.schema'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import {
  buildWhatsAppAiReplySystem,
  WHATSAPP_AI_HANDOFF_MARKER,
} from './whatsapp-ai-reply.service'

/** Output cap of an evaluated answer and of the judge. */
const ANSWER_MAX_TOKENS = 1200
const JUDGE_MAX_TOKENS = 400
const EVAL_TIMEZONE = 'America/Sao_Paulo'

const NO_TOOLS_SECTION =
  'Avaliação automática: nesta conversa você não tem ferramentas nem acesso aos dados do workspace. Responda só com o que sabe e com as instruções acima; quando a resposta depender de dados reais, diga como encontraria a informação em vez de inventar.'

export type AiEvalRunOutcome =
  | { status: 'skipped'; reason: 'not_queued' }
  | { status: 'done'; passed: number; failed: number }
  | { status: 'failed'; error: string }

interface Totals {
  passed: number
  failed: number
  graded: number
  scores: (number | null)[]
  costUsd: number
}

function skillSection(skill: AiSkill): string {
  return `Skill invocada pelo usuário: /${skill.slug} (${skill.name}). Siga estas instruções nesta resposta:\n${skill.instructions}`
}

async function systemPromptFor(
  run: AiEvalClaimedRun,
  context: {
    name: string
    modules: ModuleKind[]
    whatsappPrompt: string | null
  },
  now: Date,
): Promise<Result<string>> {
  if (run.set.target === 'WHATSAPP_REPLY') {
    return ok(
      await buildWhatsAppAiReplySystem(
        run.workspaceId,
        run.promptOverride ?? context.whatsappPrompt ?? '',
      ),
    )
  }
  const skillId = run.skillId ?? run.set.skillId
  let skill: AiSkill | null = null
  if (skillId) {
    const found = await AiSkillRepository.findById(skillId, run.workspaceId)
    if (!found.ok) return found
    skill = found.value
  }
  return ok(
    buildSteelAiSystemPrompt({
      userName: 'Avaliação automática',
      workspaceName: context.name,
      now,
      timezone: EVAL_TIMEZONE,
      modules: context.modules,
      mode: 'EXPLORE',
      sections: [skill ? skillSection(skill) : '', NO_TOOLS_SECTION],
    }),
  )
}

/** One provider call, its usage recorded as AI_EVAL; never throws. */
async function call(
  prepared: PreparedAiCall,
  run: AiEvalClaimedRun,
  request: {
    system: string
    content: string
    maxTokens: number
    json?: boolean
  },
): Promise<{ text: string; usage: AiUsageTokens; costUsd: number } | null> {
  try {
    const response = await prepared.provider.chat({
      model: prepared.model.model,
      system: request.system,
      messages: [{ role: 'user', content: request.content }],
      maxTokens: request.maxTokens,
      ...(request.json && {
        jsonSchema: {
          name: 'avaliacao',
          schema: AI_EVAL_JUDGE_JSON_SCHEMA as unknown as Record<
            string,
            unknown
          >,
        },
      }),
    })
    await AiUsageService.record(prepared, {
      workspaceId: run.workspaceId,
      userId: run.startedById,
      usage: response.usage,
    })
    return {
      text: response.text,
      usage: response.usage,
      costUsd: AiUsageService.price(prepared, response.usage),
    }
  } catch (error) {
    logger.error(
      'ai.eval_provider_failed',
      logFields(
        {
          component: 'AiEvalRunner',
          workspaceId: run.workspaceId,
          message: error instanceof Error ? error.message : String(error),
        },
        { runId: run.id, model: prepared.model.key },
      ),
    )
    return null
  }
}

async function gradeCase(
  run: AiEvalClaimedRun,
  testCase: AiEvalCase,
  answerer: PreparedAiCall,
  judge: PreparedAiCall | null,
  system: string,
): Promise<AiEvalResultData> {
  const base = {
    caseId: testCase.id,
    input: testCase.input,
    judgeScore: null,
    judgePassed: null,
    judgeRationale: null,
  }
  const answer = await call(answerer, run, {
    system,
    content: testCase.input,
    maxTokens: ANSWER_MAX_TOKENS,
  })
  if (!answer) {
    return {
      ...base,
      output: '',
      passed: false,
      checksPassed: false,
      failedChecks: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      error: 'O provedor de IA não respondeu a este caso.',
    }
  }
  const output = answer.text.replaceAll(WHATSAPP_AI_HANDOFF_MARKER, '').trim()
  const failedChecks = runTextChecks(
    output,
    testCase.mustContain,
    testCase.mustNotContain,
  )
  let inputTokens = answer.usage.inputTokens
  let outputTokens = answer.usage.outputTokens
  let costUsd = answer.costUsd
  let judgeScore: number | null = null
  let judgeRationale: string | null = null
  let error: string | null = null
  const judged = needsJudge(testCase)
  if (judged) {
    const verdict = judge
      ? await call(judge, run, {
          system: AI_EVAL_JUDGE_SYSTEM,
          content: buildJudgePrompt({
            question: testCase.input,
            answer: output,
            expected: testCase.expected,
            criteria: testCase.criteria,
          }),
          maxTokens: JUDGE_MAX_TOKENS,
          json: true,
        })
      : null
    const parsed = verdict ? parseJudgeOutput(verdict.text) : null
    if (verdict) {
      inputTokens += verdict.usage.inputTokens
      outputTokens += verdict.usage.outputTokens
      costUsd += verdict.costUsd
    }
    if (parsed) {
      judgeScore = parsed.score
      judgeRationale = parsed.rationale || null
    } else {
      error = 'O juiz não devolveu uma nota válida para este caso.'
    }
  }
  const { passed, judgePassed } = caseVerdict({
    failedChecks,
    judged,
    judgeScore,
  })
  return {
    ...base,
    output,
    passed,
    checksPassed: failedChecks.length === 0,
    failedChecks,
    judgeScore,
    judgePassed,
    judgeRationale,
    inputTokens,
    outputTokens,
    costUsd,
    error,
  }
}

async function finish(
  run: AiEvalClaimedRun,
  totals: Totals,
  extra: {
    status: 'DONE' | 'FAILED'
    modelKey: string | null
    judgeModelKey: string | null
    error: string | null
  },
  now: () => Date,
): Promise<Result<AiEvalRunOutcome>> {
  const saved = await AiEvalRepository.finishRun(run.id, {
    status: extra.status,
    modelKey: extra.modelKey,
    judgeModelKey: extra.judgeModelKey,
    caseCount: Math.max(run.caseCount, totals.graded),
    passedCount: totals.passed,
    failedCount: totals.failed,
    avgScore: averageScore(totals.scores),
    costUsd: totals.costUsd,
    error: extra.error,
    finishedAt: now(),
  })
  if (!saved.ok) return saved
  auditMutation({
    entity: 'ai_eval_run',
    action: extra.status === 'DONE' ? 'update' : 'cancel',
    actorId: null,
    targetId: run.id,
    meta: {
      workspaceId: run.workspaceId,
      setId: run.setId,
      status: extra.status,
      passed: totals.passed,
      failed: totals.failed,
    },
  })
  logger.info(
    'ai.eval_run_finished',
    logFields(
      { component: 'AiEvalRunner', workspaceId: run.workspaceId },
      {
        runId: run.id,
        status: extra.status,
        passed: totals.passed,
        failed: totals.failed,
        costUsd: totals.costUsd,
        model: extra.modelKey,
      },
    ),
  )
  return ok(
    extra.status === 'DONE'
      ? { status: 'done', passed: totals.passed, failed: totals.failed }
      : { status: 'failed', error: extra.error ?? '' },
  )
}

/**
 * Worker side of an eval run (queue `ai-eval`, ADR 0039): claims the run,
 * answers every case with the requested model (no tools), applies the text
 * checks, asks the judge for a 0..1 score when the case has an expected
 * answer or criteria, and closes the run. Usage goes to the ledger as
 * `AI_EVAL`; the quota is re-checked before every case, so a quota reached
 * mid-run ends it as FAILED with the cases graded so far.
 */
export async function executeAiEvalRun(
  runId: string,
  now: () => Date = () => new Date(),
): Promise<Result<AiEvalRunOutcome>> {
  const claimed = await AiEvalRepository.claimRun(runId, now())
  if (!claimed.ok) return claimed
  const run = claimed.value
  if (!run) return ok({ status: 'skipped', reason: 'not_queued' })

  const totals: Totals = {
    passed: 0,
    failed: 0,
    graded: 0,
    scores: [],
    costUsd: 0,
  }
  const fail = (error: string, modelKey: string | null = run.modelKey) =>
    finish(
      run,
      totals,
      { status: 'FAILED', modelKey, judgeModelKey: null, error },
      now,
    )

  const context = await AiEvalRepository.findRunContext(run.workspaceId)
  if (!context.ok) return context
  if (!context.value) return fail('Workspace não encontrado.')
  if (!context.value.aiEnabled) {
    return fail('A IA está desligada neste workspace.')
  }
  if (run.set.cases.length === 0) {
    return fail('O conjunto não tem casos de teste.')
  }

  const system = await systemPromptFor(run, context.value, now())
  if (!system.ok) return fail(system.error.message)

  let modelKey = run.modelKey
  let judgeModelKey: string | null = null
  for (const testCase of run.set.cases) {
    const answerer = await AiUsageService.prepare(
      run.workspaceId,
      'AI_EVAL',
      run.startedById,
      [run.modelKey],
    )
    if (!answerer.ok) return fail(answerer.error.message, modelKey)
    modelKey = answerer.value.model.key
    let judge: PreparedAiCall | null = null
    if (needsJudge(testCase)) {
      const prepared = await AiUsageService.prepare(
        run.workspaceId,
        'AI_EVAL',
        null,
      )
      if (!prepared.ok) return fail(prepared.error.message, modelKey)
      judge = prepared.value
      judgeModelKey = prepared.value.model.key
    }

    const result = await gradeCase(
      run,
      testCase,
      answerer.value,
      judge,
      system.value,
    )
    const saved = await AiEvalRepository.addResult(run.id, result)
    if (!saved.ok) return fail('Não foi possível salvar o resultado.', modelKey)
    totals.graded += 1
    totals.costUsd += result.costUsd
    totals.scores.push(result.judgeScore)
    if (result.passed) totals.passed += 1
    else totals.failed += 1
  }

  return finish(
    run,
    totals,
    { status: 'DONE', modelKey, judgeModelKey, error: null },
    now,
  )
}
