import type { AiEvalTarget } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { forbidden, validationError } from '@/src/errors'
import {
  aiDisabled,
  aiEvalCaseNotFound,
  aiEvalLimitReached,
  aiEvalRunInProgress,
  aiEvalRunNotFound,
  aiEvalSetEmpty,
  aiEvalSetNotFound,
  aiFeedbackTargetNotFound,
  aiModelNotEnabled,
  appError,
} from '@/src/errors/app-error'
import {
  AI_EVAL_MAX_CASES,
  AI_EVAL_MAX_SETS,
} from '@/src/lib/ai/quality-labels'
import { AiEvalJob } from '@/src/lib/queue/jobs'
import { getAiEvalQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toAiEvalCaseDTO,
  toAiEvalRunDetailDTO,
  toAiEvalRunDTO,
  toAiEvalSetDetailDTO,
  toAiEvalSetDTO,
} from '@/src/mappers/ai-eval.mapper'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import {
  AiEvalRepository,
  type AiEvalSetWithCases,
} from '@/src/repositories/ai-eval.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { AiSkillRepository } from '@/src/repositories/ai-skill.repository'
import {
  AI_EVAL_GRADING_MESSAGE,
  type AiEvalCaseFromMessageInput,
  type CreateAiEvalCaseInput,
  type CreateAiEvalSetInput,
  hasGrading,
  type StartAiEvalRunInput,
  type UpdateAiEvalCaseInput,
  type UpdateAiEvalSetInput,
} from '@/src/schemas/ai-eval.schema'
import type {
  AiEvalCaseDTO,
  AiEvalRunDetailDTO,
  AiEvalRunDTO,
  AiEvalSetDetailDTO,
  AiEvalSetDTO,
} from '@/types/ai-quality'
import { isModelUsable } from './ai-settings.service'
import { assertMember } from './authz'

/** Runs listed in a set's history. */
export const AI_EVAL_RUN_HISTORY = 20

/** Eval sets cost money (they spend the workspace quota): OWNER/ADMIN. */
async function assertAdmin(
  actorId: string,
  workspaceId: string,
): Promise<Result<true>> {
  const membership = await assertMember(actorId, workspaceId)
  if (!membership.ok) return membership
  if (!membership.value.isPrivileged) {
    return err(
      forbidden(
        'Só o dono e os administradores gerenciam as avaliações do Steel AI',
      ),
    )
  }
  return ok(true)
}

async function loadSet(
  actorId: string,
  workspaceId: string,
  setId: string,
): Promise<Result<AiEvalSetWithCases>> {
  const admin = await assertAdmin(actorId, workspaceId)
  if (!admin.ok) return admin
  const set = await AiEvalRepository.findSet(setId, workspaceId)
  if (!set.ok) return set
  if (!set.value) return err(aiEvalSetNotFound())
  return ok(set.value)
}

/** A skill the actor may evaluate: a workspace one or their own. */
async function checkSkill(
  actorId: string,
  workspaceId: string,
  skillId: string | null,
  target: AiEvalTarget,
): Promise<Result<true>> {
  if (!skillId) return ok(true)
  if (target !== 'STEEL_ASSISTANT') {
    return err(validationError('Skills só se aplicam a conjuntos do Steel AI'))
  }
  const skill = await AiSkillRepository.findById(skillId, workspaceId)
  if (!skill.ok) return skill
  if (skill.value.scope === 'PERSONAL' && skill.value.ownerId !== actorId) {
    return err(validationError('Skill não encontrada'))
  }
  return ok(true)
}

function audit(
  entity: 'ai_eval_set' | 'ai_eval_case' | 'ai_eval_run',
  action: 'create' | 'update' | 'delete' | 'start',
  actorId: string,
  targetId: string,
  meta: Record<string, unknown>,
): void {
  auditMutation({ entity, action, actorId, targetId, meta })
}

/**
 * Steel AI eval sets (ADR 0039): admins keep question → expected answer /
 * criteria cases per workspace and run them (worker queue `ai-eval`) before
 * changing the model, a prompt or a skill.
 */
export const AiEvalService = {
  async listSets(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AiEvalSetDTO[]>> {
    const admin = await assertAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const sets = await AiEvalRepository.listSets(workspaceId)
    if (!sets.ok) return sets
    return ok(sets.value.map(toAiEvalSetDTO))
  },

  async getSet(
    actorId: string,
    workspaceId: string,
    setId: string,
  ): Promise<Result<AiEvalSetDetailDTO>> {
    const set = await loadSet(actorId, workspaceId, setId)
    if (!set.ok) return set
    return ok(toAiEvalSetDetailDTO(set.value))
  },

  async createSet(
    actorId: string,
    workspaceId: string,
    input: CreateAiEvalSetInput,
  ): Promise<Result<AiEvalSetDTO>> {
    const admin = await assertAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const count = await AiEvalRepository.countSets(workspaceId)
    if (!count.ok) return count
    if (count.value >= AI_EVAL_MAX_SETS) {
      return err(
        aiEvalLimitReached(
          `O workspace já tem ${AI_EVAL_MAX_SETS} conjuntos de teste. Exclua um antes de criar outro.`,
        ),
      )
    }
    const skill = await checkSkill(
      actorId,
      workspaceId,
      input.skillId,
      input.target,
    )
    if (!skill.ok) return skill
    const created = await AiEvalRepository.createSet({
      workspaceId,
      name: input.name,
      description: input.description,
      target: input.target,
      skillId: input.skillId,
      createdById: actorId,
    })
    if (!created.ok) return created
    audit('ai_eval_set', 'create', actorId, created.value.id, {
      workspaceId,
      target: input.target,
    })
    return ok(toAiEvalSetDTO(created.value))
  },

  async updateSet(
    actorId: string,
    workspaceId: string,
    setId: string,
    input: UpdateAiEvalSetInput,
  ): Promise<Result<AiEvalSetDTO>> {
    const set = await loadSet(actorId, workspaceId, setId)
    if (!set.ok) return set
    if (input.skillId !== undefined) {
      const skill = await checkSkill(
        actorId,
        workspaceId,
        input.skillId,
        set.value.target,
      )
      if (!skill.ok) return skill
    }
    const updated = await AiEvalRepository.updateSet(setId, input)
    if (!updated.ok) return updated
    audit('ai_eval_set', 'update', actorId, setId, {
      workspaceId,
      fields: Object.keys(input),
    })
    return ok(toAiEvalSetDTO(updated.value))
  },

  /** Deletes the set with its cases, runs and results. */
  async deleteSet(
    actorId: string,
    workspaceId: string,
    setId: string,
  ): Promise<Result<void>> {
    const set = await loadSet(actorId, workspaceId, setId)
    if (!set.ok) return set
    const deleted = await AiEvalRepository.deleteSet(setId)
    if (!deleted.ok) return deleted
    audit('ai_eval_set', 'delete', actorId, setId, { workspaceId })
    return ok(undefined)
  },

  async addCase(
    actorId: string,
    workspaceId: string,
    setId: string,
    input: CreateAiEvalCaseInput & { sourceMessageId?: string | null },
  ): Promise<Result<AiEvalCaseDTO>> {
    const set = await loadSet(actorId, workspaceId, setId)
    if (!set.ok) return set
    if (set.value.caseCount >= AI_EVAL_MAX_CASES) {
      return err(
        aiEvalLimitReached(
          `Um conjunto tem no máximo ${AI_EVAL_MAX_CASES} casos de teste.`,
        ),
      )
    }
    const created = await AiEvalRepository.createCase(setId, {
      input: input.input,
      expected: input.expected,
      criteria: input.criteria,
      mustContain: input.mustContain,
      mustNotContain: input.mustNotContain,
      sourceMessageId: input.sourceMessageId ?? null,
    })
    if (!created.ok) return created
    audit('ai_eval_case', 'create', actorId, created.value.id, {
      workspaceId,
      setId,
      fromMessage: Boolean(input.sourceMessageId),
    })
    return ok(toAiEvalCaseDTO(created.value))
  },

  async updateCase(
    actorId: string,
    workspaceId: string,
    setId: string,
    caseId: string,
    input: UpdateAiEvalCaseInput,
  ): Promise<Result<AiEvalCaseDTO>> {
    const set = await loadSet(actorId, workspaceId, setId)
    if (!set.ok) return set
    const found = await AiEvalRepository.findCase(caseId, setId)
    if (!found.ok) return found
    if (!found.value) return err(aiEvalCaseNotFound())
    if (!hasGrading({ ...found.value, ...input })) {
      return err(validationError(AI_EVAL_GRADING_MESSAGE))
    }
    const updated = await AiEvalRepository.updateCase(caseId, input)
    if (!updated.ok) return updated
    audit('ai_eval_case', 'update', actorId, caseId, { workspaceId, setId })
    return ok(toAiEvalCaseDTO(updated.value))
  },

  async deleteCase(
    actorId: string,
    workspaceId: string,
    setId: string,
    caseId: string,
  ): Promise<Result<void>> {
    const set = await loadSet(actorId, workspaceId, setId)
    if (!set.ok) return set
    const found = await AiEvalRepository.findCase(caseId, setId)
    if (!found.ok) return found
    if (!found.value) return err(aiEvalCaseNotFound())
    const deleted = await AiEvalRepository.deleteCase(caseId)
    if (!deleted.ok) return deleted
    audit('ai_eval_case', 'delete', actorId, caseId, { workspaceId, setId })
    return ok(undefined)
  },

  /**
   * "Salvar como caso de teste" from a Steel AI answer: the question is the
   * user turn before it, the expected answer is the answer itself. Chats are
   * private, so only the conversation's owner saves its turns.
   */
  async caseFromMessage(
    actorId: string,
    workspaceId: string,
    input: AiEvalCaseFromMessageInput,
  ): Promise<Result<AiEvalCaseDTO>> {
    const admin = await assertAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const turn = await AiEvalRepository.findSourceTurn(
      input.messageId,
      workspaceId,
    )
    if (!turn.ok) return turn
    if (!turn.value || turn.value.conversationUserId !== actorId) {
      return err(aiFeedbackTargetNotFound())
    }
    if (!turn.value.question?.trim() || !turn.value.answer.trim()) {
      return err(
        validationError(
          'Esta resposta não tem uma pergunta em texto para virar caso de teste',
        ),
      )
    }
    return AiEvalService.addCase(actorId, workspaceId, input.setId, {
      input: turn.value.question.trim().slice(0, 4000),
      expected: turn.value.answer.trim().slice(0, 4000),
      criteria: input.criteria,
      mustContain: [],
      mustNotContain: [],
      sourceMessageId: input.messageId,
    })
  },

  async startRun(
    actorId: string,
    workspaceId: string,
    setId: string,
    input: StartAiEvalRunInput,
  ): Promise<Result<AiEvalRunDTO>> {
    const set = await loadSet(actorId, workspaceId, setId)
    if (!set.ok) return set
    if (set.value.caseCount === 0) return err(aiEvalSetEmpty())
    if (set.value.target === 'STEEL_AGENT') {
      return err(
        validationError(
          'Conjuntos de Steel Agents rodam sozinhos quando você edita um agente que usa o conjunto como trava',
        ),
      )
    }
    if (input.promptOverride && set.value.target !== 'WHATSAPP_REPLY') {
      return err(
        validationError(
          'O prompt em rascunho só vale para conjuntos da resposta automática do WhatsApp',
        ),
      )
    }

    const settingsRow =
      await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
    if (!settingsRow.ok) return settingsRow
    const settings = toEffectiveAiSettings(settingsRow.value)
    if (!settings.aiEnabled) return err(aiDisabled())
    if (input.modelKey && !isModelUsable(settings, input.modelKey)) {
      return err(aiModelNotEnabled())
    }
    const skill = await checkSkill(
      actorId,
      workspaceId,
      input.skillId,
      set.value.target,
    )
    if (!skill.ok) return skill

    const active = await AiEvalRepository.findActiveRun(setId)
    if (!active.ok) return active
    if (active.value) return err(aiEvalRunInProgress())

    const run = await AiEvalRepository.createRun({
      workspaceId,
      setId,
      modelKey: input.modelKey,
      skillId: input.skillId,
      promptOverride: input.promptOverride,
      reason: input.reason,
      startedById: actorId,
      caseCount: set.value.caseCount,
    })
    if (!run.ok) return run

    try {
      await getAiEvalQueue().add(
        AiEvalJob.Run,
        { runId: run.value.id },
        { jobId: `ai-eval-${run.value.id}` },
      )
    } catch (error) {
      logger.error(
        'ai.eval_enqueue_failed',
        logFields(
          {
            component: 'AiEvalService',
            workspaceId,
            message: error instanceof Error ? error.message : String(error),
          },
          { runId: run.value.id },
        ),
      )
      await AiEvalRepository.finishRun(run.value.id, {
        status: 'FAILED',
        modelKey: input.modelKey,
        judgeModelKey: null,
        caseCount: set.value.caseCount,
        passedCount: 0,
        failedCount: 0,
        avgScore: null,
        costUsd: 0,
        error: 'Não foi possível enfileirar a avaliação. Tente de novo.',
        finishedAt: new Date(),
      })
      return err(
        appError(
          'INTERNAL_SERVER_ERROR',
          'Não foi possível enfileirar a avaliação. Tente de novo em instantes.',
        ),
      )
    }

    audit('ai_eval_run', 'start', actorId, run.value.id, {
      workspaceId,
      setId,
      reason: input.reason,
      modelKey: input.modelKey,
      draftPrompt: Boolean(input.promptOverride),
    })
    return ok(toAiEvalRunDTO(run.value))
  },

  async listRuns(
    actorId: string,
    workspaceId: string,
    setId: string,
  ): Promise<Result<AiEvalRunDTO[]>> {
    const set = await loadSet(actorId, workspaceId, setId)
    if (!set.ok) return set
    const runs = await AiEvalRepository.listRuns(setId, AI_EVAL_RUN_HISTORY)
    if (!runs.ok) return runs
    return ok(runs.value.map(toAiEvalRunDTO))
  },

  async getRun(
    actorId: string,
    workspaceId: string,
    setId: string,
    runId: string,
  ): Promise<Result<AiEvalRunDetailDTO>> {
    const admin = await assertAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const run = await AiEvalRepository.findRun(runId, workspaceId)
    if (!run.ok) return run
    if (!run.value || run.value.setId !== setId) {
      return err(aiEvalRunNotFound())
    }
    return ok(toAiEvalRunDetailDTO(run.value))
  },

  /**
   * "Rodar avaliação antes de trocar": every set of a target with its last
   * finished run, for the model, prompt and skill settings.
   */
  async latest(
    actorId: string,
    workspaceId: string,
    target: AiEvalTarget,
  ): Promise<Result<AiEvalSetDTO[]>> {
    const admin = await assertAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const rows = await AiEvalRepository.latestDoneByTarget(workspaceId, target)
    if (!rows.ok) return rows
    return ok(
      rows.value.map((row) =>
        toAiEvalSetDTO({
          ...row.set,
          caseCount: row.caseCount,
          lastRun: row.run,
        }),
      ),
    )
  },
}
