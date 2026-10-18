import type { AiEvalCase, AiEvalResult } from '@prisma/client'
import { findAiModel } from '@/src/lib/ai/models'
import {
  AI_EVAL_RUN_REASONS,
  AI_EVAL_TARGET_LABELS,
  type AiEvalRunReason,
} from '@/src/lib/ai/quality-labels'
import type {
  AiEvalRunWithResults,
  AiEvalRunWithUser,
  AiEvalSetSummary,
  AiEvalSetWithCases,
} from '@/src/repositories/ai-eval.repository'
import type {
  AiEvalCaseDTO,
  AiEvalResultDTO,
  AiEvalRunDetailDTO,
  AiEvalRunDTO,
  AiEvalSetDetailDTO,
  AiEvalSetDTO,
} from '@/types/ai-quality'

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

function reasonOf(value: string): AiEvalRunReason {
  return (AI_EVAL_RUN_REASONS as readonly string[]).includes(value)
    ? (value as AiEvalRunReason)
    : 'manual'
}

export function toAiEvalCaseDTO(row: AiEvalCase): AiEvalCaseDTO {
  return {
    id: row.id,
    input: row.input,
    expected: row.expected,
    criteria: row.criteria,
    mustContain: row.mustContain,
    mustNotContain: row.mustNotContain,
    sourceMessageId: row.sourceMessageId,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toAiEvalRunDTO(row: AiEvalRunWithUser): AiEvalRunDTO {
  const done = row.status === 'DONE' || row.status === 'FAILED'
  return {
    id: row.id,
    setId: row.setId,
    status: row.status,
    modelKey: row.modelKey,
    modelLabel: row.modelKey
      ? (findAiModel(row.modelKey)?.label ?? row.modelKey)
      : null,
    judgeModelKey: row.judgeModelKey,
    skillId: row.skillId,
    hasPromptOverride: Boolean(row.promptOverride),
    reason: reasonOf(row.reason),
    startedBy: row.startedBy
      ? { id: row.startedBy.id, name: row.startedBy.name }
      : null,
    caseCount: row.caseCount,
    passedCount: row.passedCount,
    failedCount: row.failedCount,
    passRate:
      done && row.caseCount > 0 ? row.passedCount / row.caseCount : null,
    avgScore: row.avgScore,
    costUsd: row.costUsd.toNumber(),
    error: row.error,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toAiEvalResultDTO(row: AiEvalResult): AiEvalResultDTO {
  return {
    id: row.id,
    caseId: row.caseId,
    input: row.input,
    output: row.output,
    passed: row.passed,
    checksPassed: row.checksPassed,
    failedChecks: row.failedChecks,
    judgeScore: row.judgeScore,
    judgePassed: row.judgePassed,
    judgeRationale: row.judgeRationale,
    costUsd: row.costUsd.toNumber(),
    error: row.error,
  }
}

export function toAiEvalRunDetailDTO(
  row: AiEvalRunWithResults,
): AiEvalRunDetailDTO {
  return {
    ...toAiEvalRunDTO(row),
    results: row.results.map(toAiEvalResultDTO),
  }
}

export function toAiEvalSetDTO(row: AiEvalSetSummary): AiEvalSetDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    target: row.target,
    targetLabel: AI_EVAL_TARGET_LABELS[row.target],
    skillId: row.skillId,
    caseCount: row.caseCount,
    lastRun: row.lastRun ? toAiEvalRunDTO(row.lastRun) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toAiEvalSetDetailDTO(
  row: AiEvalSetWithCases,
): AiEvalSetDetailDTO {
  return { ...toAiEvalSetDTO(row), cases: row.cases.map(toAiEvalCaseDTO) }
}
