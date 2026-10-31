/**
 * C4 - opportunity health (per-deal version of T4). Same mechanics
 * (`./core`), different factors: days stalled, customer engagement, change of
 * contact, close date, overdue tasks and the lack of a scheduled next step.
 */

import {
  buildHealth,
  daysBetween,
  type HealthComputation,
  type HealthFactorOutcome,
  type HealthFactorSpec,
  type HealthNextAction,
  pluralDays,
  ramp,
} from './core'

export const OPPORTUNITY_FACTOR_KEYS = [
  'stalled',
  'engagement',
  'contact',
  'close_date',
  'overdue_tasks',
  'no_next_step',
] as const

export type OpportunityFactorKey = (typeof OPPORTUNITY_FACTOR_KEYS)[number]

/** Weights sum 100 (a test locks it). */
export const OPPORTUNITY_FACTOR_SPECS: HealthFactorSpec<OpportunityFactorKey>[] =
  [
    { key: 'stalled', label: 'Negócio parado', weight: 35 },
    { key: 'engagement', label: 'Sem contato com o cliente', weight: 20 },
    { key: 'contact', label: 'Contato principal', weight: 15 },
    { key: 'close_date', label: 'Data de fechamento', weight: 15 },
    { key: 'no_next_step', label: 'Sem próximo passo agendado', weight: 8 },
    { key: 'overdue_tasks', label: 'Tarefas atrasadas', weight: 7 },
  ]

export interface OpportunityHealthSignals {
  now: Date
  createdAt: Date
  /** Last change of stage, or null when it never moved. */
  stageChangedAt: Date | null
  /** Any activity: edit, note, task update, e-mail, meeting, message, call. */
  lastActivityAt: Date | null
  /** Customer-facing only: e-mail, meeting held, WhatsApp, phone call. */
  lastInteractionAt: Date | null
  closeDate: Date | null
  pointOfContactId: string | null
  contactChangedAt: Date | null
  overdueTasks: number
  /** Open task with a future (or no) due date, or a meeting still to come. */
  hasNextStep: boolean
}

const OPPORTUNITY_ACTIONS: Record<OpportunityFactorKey, HealthNextAction> = {
  stalled: {
    key: 'reactivate',
    label: 'Retomar o negócio hoje',
    detail:
      'Ligue ou envie um WhatsApp ao contato e registre o que ficou combinado.',
  },
  engagement: {
    key: 'engage',
    label: 'Falar com o cliente',
    detail:
      'O cliente não interage há dias. Marque uma conversa ou mande uma mensagem de valor.',
  },
  contact: {
    key: 'confirm_contact',
    label: 'Confirmar o contato principal',
    detail:
      'Defina quem decide neste negócio e registre o contato na oportunidade.',
  },
  close_date: {
    key: 'update_close_date',
    label: 'Atualizar a data de fechamento',
    detail:
      'Combine uma data realista com o cliente e registre no negócio, ou perca-o com o motivo.',
  },
  no_next_step: {
    key: 'schedule_next_step',
    label: 'Agendar o próximo passo',
    detail:
      'Crie uma tarefa ou uma reunião para que o negócio não fique solto.',
  },
  overdue_tasks: {
    key: 'clear_tasks',
    label: 'Concluir as tarefas atrasadas',
    detail: 'Há tarefas deste negócio com o prazo vencido.',
  },
}

const HEALTHY_ACTION: HealthNextAction = {
  key: 'advance',
  label: 'Avançar para a próxima etapa',
  detail: 'O negócio está saudável: mantenha o ritmo e peça o próximo passo.',
}

export const OPPORTUNITY_NEXT_ACTIONS = OPPORTUNITY_ACTIONS
export const OPPORTUNITY_HEALTHY_ACTION = HEALTHY_ACTION

const STALLED_OK_DAYS = 7
const STALLED_BAD_DAYS = 30

function stalled(s: OpportunityHealthSignals): HealthFactorOutcome {
  const since = latest(
    s.lastActivityAt,
    s.stageChangedAt,
    s.lastInteractionAt,
    s.createdAt,
  )
  const days = daysBetween(since, s.now)
  return {
    key: 'stalled',
    applicable: true,
    ratio: ramp(days, STALLED_OK_DAYS, STALLED_BAD_DAYS),
    detail:
      days === 0
        ? 'Movimentado hoje'
        : `Sem movimentação há ${pluralDays(days)}`,
  }
}

function engagement(s: OpportunityHealthSignals): HealthFactorOutcome {
  // A deal opened a moment ago has had no time to interact: count from birth.
  const since = s.lastInteractionAt ?? s.createdAt
  const days = daysBetween(since, s.now)
  return {
    key: 'engagement',
    applicable: true,
    ratio: ramp(days, 7, 30),
    detail: s.lastInteractionAt
      ? `Último contato com o cliente há ${pluralDays(days)}`
      : `Nenhum contato com o cliente em ${pluralDays(days)}`,
  }
}

function contact(s: OpportunityHealthSignals): HealthFactorOutcome {
  if (!s.pointOfContactId) {
    return {
      key: 'contact',
      applicable: true,
      ratio: 1,
      detail: 'Negócio sem contato principal',
    }
  }
  if (s.contactChangedAt) {
    const days = daysBetween(s.contactChangedAt, s.now)
    if (days <= 30) {
      return {
        key: 'contact',
        applicable: true,
        ratio: 2 / 3,
        detail: `O contato principal mudou há ${pluralDays(days)}`,
      }
    }
  }
  return {
    key: 'contact',
    applicable: true,
    ratio: 0,
    detail: 'Contato principal estável',
  }
}

function closeDate(s: OpportunityHealthSignals): HealthFactorOutcome {
  if (!s.closeDate) {
    return {
      key: 'close_date',
      applicable: true,
      ratio: 0.3,
      detail: 'Sem data de fechamento prevista',
    }
  }
  const late = daysBetween(s.closeDate, s.now)
  if (s.closeDate.getTime() > s.now.getTime() || late === 0) {
    return {
      key: 'close_date',
      applicable: true,
      ratio: 0,
      detail: 'Dentro da data de fechamento',
    }
  }
  return {
    key: 'close_date',
    applicable: true,
    ratio: 0.4 + 0.6 * ramp(late, 1, 30),
    detail: `Data de fechamento vencida há ${pluralDays(late)}`,
  }
}

function overdueTasks(s: OpportunityHealthSignals): HealthFactorOutcome {
  return {
    key: 'overdue_tasks',
    applicable: true,
    ratio: ramp(s.overdueTasks, 0, 2),
    detail:
      s.overdueTasks === 0
        ? 'Sem tarefas atrasadas'
        : `${s.overdueTasks} tarefa(s) atrasada(s)`,
  }
}

function noNextStep(s: OpportunityHealthSignals): HealthFactorOutcome {
  return {
    key: 'no_next_step',
    applicable: true,
    ratio: s.hasNextStep ? 0 : 1,
    detail: s.hasNextStep
      ? 'Próximo passo agendado'
      : 'Nenhuma tarefa aberta nem reunião futura',
  }
}

function latest(...dates: (Date | null)[]): Date {
  let best: Date | null = null
  for (const date of dates) {
    if (date && (!best || date.getTime() > best.getTime())) best = date
  }
  // `createdAt` is always among the arguments, so `best` is never null.
  return best as Date
}

/** Pure: the risk of an open deal from its signals. */
export function computeOpportunityHealth(
  signals: OpportunityHealthSignals,
): HealthComputation {
  return buildHealth(
    OPPORTUNITY_FACTOR_SPECS,
    [
      stalled(signals),
      engagement(signals),
      contact(signals),
      closeDate(signals),
      overdueTasks(signals),
      noNextStep(signals),
    ],
    OPPORTUNITY_ACTIONS,
    HEALTHY_ACTION,
  )
}
