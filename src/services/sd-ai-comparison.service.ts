import { logger } from '@/lib/axiom/logger'
import {
  AI_USAGE_FEATURE_LABELS,
  type AiUsageFeatureKey,
} from '@/src/lib/ai/usage-labels'
import { ok, type Result } from '@/src/lib/result'
import {
  compareSdAiClassification,
  isSdAiMatch,
  SD_AI_FIELD_LABEL,
  type SdAiFieldComparison,
  SdAiFieldTally,
  type SdAiFinalState,
  sdAiCalibration,
  sdAiPercent,
  sdAiTextOutcome,
  sdAiTextSimilarity,
} from '@/src/lib/servicedesk/ai-comparison'
import {
  type SdAiAgentMessageRow,
  SdAiComparisonRepository,
  type SdAiComparisonTicketRow,
  type SdAiSuggestionRow,
} from '@/src/repositories/sd-ai-comparison.repository'
import type { SdAiComparisonQueryDTO } from '@/src/schemas/sd-ai-comparison.schema'
import type { SdAiClassificationDTO, SdAiTriageRecordDTO } from '@/types/sd-ai'
import type {
  SdAiAgentStatDTO,
  SdAiComparisonDTO,
  SdAiDivergenceDTO,
  SdAiPreServiceDTO,
  SdAiTextOutcome,
  SdAiTextStatDTO,
  SdAiUsageDTO,
} from '@/types/sd-ai-comparison'
import { SdAccess } from './sd-access'
import { SdTicketEngine, sdTicketCode } from './sd-ticket-engine'

/**
 * Painel "IA vs. técnico": compara o que a IA sugeriu (triagem automática e
 * copiloto) com o que o técnico fez, para medir a precisão e justificar a
 * cota de IA. Só leitura; nada aqui chama a IA.
 *
 * - **Triagem**: `SdTicket.aiTriage` guarda a sugestão e o que foi aplicado;
 *   o estado atual do chamado é a resposta do técnico.
 * - **Copiloto**: cada rascunho entregue vira uma linha em `SdAiSuggestion`
 *   (`SdAiService`); resposta e solução são comparadas por similaridade de
 *   texto com o que o agente escreveu depois.
 * - Só chamados **resolvidos ou fechados** entram na precisão: antes disso o
 *   técnico ainda pode corrigir a IA.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const DIVERGENCE_LIMIT = 20
/** Metade dos campos coincidindo já conta a classificação como aproveitada. */
const USED_RATIO = 0.5

const KNOWN_KINDS = new Set(['REPLY', 'SOLUTION', 'CLASSIFICATION'])

const SD_FEATURES: AiUsageFeatureKey[] = [
  'SERVICEDESK_TRIAGE',
  'SERVICEDESK_COPILOT',
  'SERVICEDESK_PRE_SERVICE',
]

function isSettled(row: SdAiComparisonTicketRow): boolean {
  return row.phaseCategory === 'RESOLVED' || row.phaseCategory === 'CLOSED'
}

function finalState(row: SdAiComparisonTicketRow): SdAiFinalState {
  return {
    refs: {
      category: row.category ?? undefined,
      subcategory: row.subcategory ?? undefined,
      service: row.service ?? undefined,
      impact: row.impact ?? undefined,
      urgency: row.urgency ?? undefined,
      priority: row.priority ?? undefined,
      department: row.department ?? undefined,
    },
    tags: row.tags,
  }
}

function asTriageRecord(raw: unknown): SdAiTriageRecordDTO | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Partial<SdAiTriageRecordDTO>
  if (!record.suggestions || typeof record.suggestions !== 'object') return null
  return {
    suggestions: {
      ...record.suggestions,
      tags: Array.isArray(record.suggestions.tags)
        ? record.suggestions.tags
        : [],
      confidence: Number(record.suggestions.confidence) || 0,
    },
    applied: Array.isArray(record.applied) ? record.applied : [],
    model: record.model ?? '',
    at: record.at ?? '',
  }
}

function asClassification(raw: unknown): SdAiClassificationDTO | null {
  return asTriageRecord({ suggestions: raw })?.suggestions ?? null
}

interface AgentTally {
  suggestions: number
  evaluated: number
  used: number
}

class Divergences {
  private readonly items: Array<SdAiDivergenceDTO> = []

  add(
    row: SdAiComparisonTicketRow,
    code: string,
    comparison: SdAiFieldComparison,
    at: Date,
  ): void {
    if (isSdAiMatch(comparison.outcome)) return
    this.items.push({
      ticketId: row.id,
      code,
      title: row.title,
      field: comparison.field,
      fieldLabel: SD_AI_FIELD_LABEL[comparison.field],
      suggested: comparison.suggested,
      final: comparison.final,
      appliedByAi: comparison.appliedByAi,
      at: at.toISOString(),
    })
  }

  latest(): SdAiDivergenceDTO[] {
    return this.items
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, DIVERGENCE_LIMIT)
  }
}

function preServiceOf(
  rows: Array<{ outcome: string | null; total: number }>,
): SdAiPreServiceDTO {
  const count = (outcome: string | null) =>
    rows.find((r) => r.outcome === outcome)?.total ?? 0
  const resolvedByKb = count('resolved_by_kb')
  const ticketOpened = count('ticket_opened')
  const abandoned = count('abandoned')
  const open = rows
    .filter(
      (r) =>
        r.outcome !== 'resolved_by_kb' &&
        r.outcome !== 'ticket_opened' &&
        r.outcome !== 'abandoned',
    )
    .reduce((sum, r) => sum + r.total, 0)
  const conversations = resolvedByKb + ticketOpened + abandoned + open
  return {
    conversations,
    resolvedByKb,
    ticketOpened,
    abandoned,
    open,
    deflectionRate: sdAiPercent(resolvedByKb, conversations - open),
  }
}

function textOutcomeOf(
  suggestion: SdAiSuggestionRow,
  ticket: SdAiComparisonTicketRow,
  messages: SdAiAgentMessageRow[],
  now: Date,
): SdAiTextOutcome {
  const text = suggestion.text ?? ''
  let best: number | null = null
  if (suggestion.kind === 'SOLUTION') {
    if (ticket.solution) best = sdAiTextSimilarity(text, ticket.solution)
  } else {
    for (const message of messages) {
      if (
        message.ticketId !== suggestion.ticketId ||
        message.authorUserId !== suggestion.userId ||
        message.createdAt < suggestion.createdAt
      ) {
        continue
      }
      const score = sdAiTextSimilarity(text, message.body)
      if (best === null || score > best) best = score
    }
  }
  // A solução só é escrita no fim: com o chamado aberto, ainda pode vir.
  if (best === null && suggestion.kind === 'SOLUTION' && !isSettled(ticket)) {
    return 'PENDING'
  }
  return sdAiTextOutcome(best, suggestion.createdAt, now)
}

function textStat(
  kind: 'REPLY' | 'SOLUTION',
  label: string,
  outcomes: SdAiTextOutcome[],
): SdAiTextStatDTO {
  const adopted = outcomes.filter((o) => o === 'ADOPTED').length
  const edited = outcomes.filter((o) => o === 'EDITED').length
  const notUsed = outcomes.filter((o) => o === 'NOT_USED').length
  const pending = outcomes.filter((o) => o === 'PENDING').length
  return {
    kind,
    label,
    total: outcomes.length,
    adopted,
    edited,
    notUsed,
    pending,
    usageRate: sdAiPercent(adopted + edited, outcomes.length - pending),
  }
}

export const SdAiComparisonService = {
  /**
   * Painel completo do período. Mesma permissão do histórico de relatórios
   * (`sd-reports`) e só agentes: a leitura expõe o desempenho dos agentes.
   */
  async overview(
    actorId: string,
    workspaceId: string,
    query: SdAiComparisonQueryDTO,
    now: Date = new Date(),
  ): Promise<Result<SdAiComparisonDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-reports',
      action: 'VIEW',
    })
    if (!ctx.ok) return ctx
    const config = await SdTicketEngine.loadConfig(workspaceId)
    if (!config.ok) return config
    const { prefixes } = config.value

    const from = new Date(now.getTime() - query.days * DAY_MS)
    const [triaged, suggestions, usage, preService] = await Promise.all([
      SdAiComparisonRepository.listTriaged(workspaceId, from),
      SdAiComparisonRepository.listSuggestions(workspaceId, from),
      SdAiComparisonRepository.usageByFeature(workspaceId, from, now),
      SdAiComparisonRepository.preServiceOutcomes(workspaceId, from),
    ])
    if (!triaged.ok) return triaged
    if (!suggestions.ok) return suggestions
    if (!usage.ok) return usage
    if (!preService.ok) return preService

    const suggestedTicketIds = [
      ...new Set(suggestions.value.map((s) => s.ticketId)),
    ]
    const replyTicketIds = [
      ...new Set(
        suggestions.value
          .filter((s) => s.kind === 'REPLY')
          .map((s) => s.ticketId),
      ),
    ]
    const [tickets, messages] = await Promise.all([
      SdAiComparisonRepository.listTicketsByIds(
        workspaceId,
        suggestedTicketIds,
      ),
      SdAiComparisonRepository.listAgentMessages(workspaceId, replyTicketIds),
    ])
    if (!tickets.ok) return tickets
    if (!messages.ok) return messages
    const ticketById = new Map(tickets.value.map((t) => [t.id, t]))

    const tally = new SdAiFieldTally()
    const divergences = new Divergences()
    const calibrationSamples: Array<{
      confidence: number
      compared: number
      matched: number
    }> = []
    let settled = 0
    let awaitingReview = 0
    let confidenceSum = 0
    let confidenceCount = 0
    let triageUsed = 0

    // 1. Triagem automática.
    for (const row of triaged.value) {
      if (row.phaseCategory === 'CANCELED') continue
      const record = asTriageRecord(row.aiTriage)
      if (!record) continue
      confidenceSum += record.suggestions.confidence
      confidenceCount++
      if (!isSettled(row)) {
        awaitingReview++
        continue
      }
      settled++
      const comparisons = compareSdAiClassification(
        record.suggestions,
        record.applied,
        finalState(row),
      )
      const code = sdTicketCode(row, prefixes)
      const at = new Date(record.at || row.createdAt)
      let matched = 0
      for (const comparison of comparisons) {
        tally.add(comparison)
        if (isSdAiMatch(comparison.outcome)) matched++
        divergences.add(row, code, comparison, at)
      }
      calibrationSamples.push({
        confidence: record.suggestions.confidence,
        compared: comparisons.length,
        matched,
      })
      if (
        comparisons.length > 0 &&
        matched >= comparisons.length * USED_RATIO
      ) {
        triageUsed++
      }
    }

    // 2. Copiloto: classificação, resposta e solução.
    const agents = new Map<string, AgentTally>()
    const tallyAgent = (userId: string | null) => {
      const key = userId ?? ''
      const current = agents.get(key) ?? {
        suggestions: 0,
        evaluated: 0,
        used: 0,
      }
      agents.set(key, current)
      return current
    }
    const outcomes: Record<'REPLY' | 'SOLUTION', SdAiTextOutcome[]> = {
      REPLY: [],
      SOLUTION: [],
    }
    let copilotUsed = 0
    for (const suggestion of suggestions.value) {
      const ticket = ticketById.get(suggestion.ticketId)
      if (!ticket || suggestion.userId === null) continue
      if (!KNOWN_KINDS.has(suggestion.kind)) continue
      const agent = tallyAgent(suggestion.userId)
      agent.suggestions++

      if (suggestion.kind === 'CLASSIFICATION') {
        const payload = asClassification(suggestion.payload)
        if (!payload || !isSettled(ticket)) continue
        const comparisons = compareSdAiClassification(
          payload,
          [],
          finalState(ticket),
        )
        if (comparisons.length === 0) continue
        const code = sdTicketCode(ticket, prefixes)
        let matched = 0
        for (const comparison of comparisons) {
          tally.add(comparison)
          if (isSdAiMatch(comparison.outcome)) matched++
          divergences.add(ticket, code, comparison, suggestion.createdAt)
        }
        agent.evaluated++
        if (matched >= comparisons.length * USED_RATIO) {
          agent.used++
          copilotUsed++
        }
        continue
      }

      const kind = suggestion.kind as 'REPLY' | 'SOLUTION'
      const outcome = textOutcomeOf(suggestion, ticket, messages.value, now)
      outcomes[kind].push(outcome)
      if (outcome === 'PENDING') continue
      agent.evaluated++
      if (outcome === 'ADOPTED' || outcome === 'EDITED') {
        agent.used++
        copilotUsed++
      }
    }

    // 3. Agentes (nomes) e consumo da cota.
    const agentIds = [...agents.keys()].filter(Boolean)
    const names = await SdAiComparisonRepository.userNames(agentIds)
    if (!names.ok) return names
    const nameById = new Map(names.value.map((u) => [u.id, u.name]))
    const agentStats: SdAiAgentStatDTO[] = agentIds
      .map((userId) => {
        const t = agents.get(userId) as AgentTally
        return {
          userId,
          name: nameById.get(userId) ?? 'Agente removido',
          suggestions: t.suggestions,
          used: t.used,
          usageRate: sdAiPercent(t.used, t.evaluated),
        }
      })
      .sort((a, b) => b.suggestions - a.suggestions)

    const usedTotal = triageUsed + copilotUsed
    const usageDto = usageOf(usage.value, usedTotal)

    logger.info('servicedesk.ai.comparison', {
      workspaceId,
      days: query.days,
      triaged: confidenceCount,
      suggestions: suggestions.value.length,
    })

    return ok({
      periodDays: query.days,
      from: from.toISOString(),
      to: now.toISOString(),
      summary: {
        triaged: confidenceCount,
        settled,
        awaitingReview,
        accuracy: sdAiPercent(tally.matched, tally.compared),
        corrections: tally.corrected,
        avgConfidence:
          confidenceCount > 0
            ? Math.round((confidenceSum / confidenceCount) * 100)
            : null,
      },
      fields: tally.toStats(),
      calibration: sdAiCalibration(calibrationSamples),
      texts: [
        textStat('REPLY', 'Respostas sugeridas', outcomes.REPLY),
        textStat('SOLUTION', 'Soluções sugeridas', outcomes.SOLUTION),
      ],
      agents: agentStats,
      preService: preServiceOf(preService.value),
      usage: usageDto,
      divergences: divergences.latest(),
    })
  },
}

function usageOf(
  rows: Array<{ feature: string; calls: number; costUsd: number }>,
  usedTotal: number,
): SdAiUsageDTO {
  const features = SD_FEATURES.map((feature) => {
    const row = rows.find((r) => r.feature === feature)
    return {
      feature,
      label: AI_USAGE_FEATURE_LABELS[feature],
      calls: row?.calls ?? 0,
      costUsd: row?.costUsd ?? 0,
    }
  })
  const calls = features.reduce((sum, f) => sum + f.calls, 0)
  const costUsd = features.reduce((sum, f) => sum + f.costUsd, 0)
  return {
    calls,
    costUsd,
    costPerUsedUsd: usedTotal > 0 ? costUsd / usedTotal : null,
    features,
  }
}
