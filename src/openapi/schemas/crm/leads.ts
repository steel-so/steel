import { z } from 'zod'
import {
  CrmLeadContactOutcomeEnum,
  CrmLeadInterestLevelEnum,
  CrmLeadStageEnum,
} from '@/src/schemas/crm-lead.schema'
import { dto } from '../../common'
import { CrmLeadDTO } from '../public'

/**
 * DTOs do funil de leads (`types/crm-lead.d.ts`, `src/mappers/crm-lead.mapper.ts`).
 * O lead em si (`CrmLead`) fica em `../public` — é o mesmo da API de integração.
 */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()

const RULE_FIELDS = [
  'name',
  'email',
  'phone',
  'company',
  'jobTitle',
  'source',
  'city',
] as const

const RULE_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'is_empty',
  'is_not_empty',
] as const

export const CrmLeadContactAttemptDTO = dto(
  'CrmLeadContactAttempt',
  z.object({
    id: z.string(),
    leadId: z.string(),
    workspaceId: z.string(),
    contactedWith: z.string().meta({ example: 'Carlos (TI)' }),
    channel: z.enum(['PHONE', 'WHATSAPP', 'EMAIL', 'MEETING', 'OTHER']),
    outcome: CrmLeadContactOutcomeEnum.meta({
      description:
        '`ATTEMPTED` = tentativa sem retorno; `REACHED` = contato efetivo.',
    }),
    occurredAt: dateTime(),
    note: z.string().nullable(),
    createdById: z.string(),
    createdAt: dateTime(),
  }),
)

export const CrmLeadQualificationDTO = dto(
  'CrmLeadQualification',
  z.object({
    id: z.string(),
    leadId: z.string(),
    expectedCloseAt: nullableDateTime(),
    decisionMakerName: z.string().meta({ example: 'Ana Pereira' }),
    decisionMakerRole: z.string().meta({ example: 'Diretora de TI' }),
    qualifiedById: z.string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmLeadMeetingDTO = dto(
  'CrmLeadMeeting',
  z.object({
    id: z.string(),
    leadId: z.string(),
    workspaceId: z.string(),
    scheduledAt: dateTime(),
    format: z.enum(['IN_PERSON', 'ONLINE']),
    contactPersonId: z.string().nullable().meta({
      description: 'Pessoa do CRM com quem foi a reunião (opcional).',
    }),
    contactPersonName: z.string().nullable(),
    interestDetails: z.string(),
    identifiedNeed: z.string(),
    createdById: z.string(),
    createdAt: dateTime(),
  }),
)

export const CrmLeadProposalPresentationDTO = dto(
  'CrmLeadProposalPresentation',
  z.object({
    id: z.string(),
    leadId: z.string(),
    proposalId: z.string(),
    presentedAt: dateTime(),
    format: z.enum(['IN_PERSON', 'ONLINE', 'EMAIL', 'OTHER']),
    amount: z.number().meta({ description: 'Valor apresentado.' }),
    interestLevel: CrmLeadInterestLevelEnum.meta({
      description: 'Termômetro de interesse do cliente.',
    }),
    interactionsCount: z.number().int(),
    createdById: z.string(),
    createdAt: dateTime(),
  }),
)

export const CrmLeadReopeningDTO = dto(
  'CrmLeadReopening',
  z
    .object({
      id: z.string(),
      leadId: z.string(),
      toStage: CrmLeadStageEnum,
      reason: z.string(),
      previousLostReason: z.string().nullable(),
      previousLostNote: z.string().nullable(),
      previousClosedAt: nullableDateTime(),
      previousRetryAt: nullableDateTime(),
      reopenedById: z.string(),
      createdAt: dateTime(),
    })
    .meta({
      description:
        'Reabertura de um lead perdido, com o snapshot da perda desfeita.',
    }),
)

export const CrmLeadScoringRuleDTO = dto(
  'CrmLeadScoringRule',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    field: z
      .enum([
        ...RULE_FIELDS,
        'newsletter_subscribed',
        'newsletter_opened',
        'newsletter_clicked',
      ])
      .meta({
        description:
          'Campo do lead, ou evento de engajamento da newsletter (`newsletter_*`), que pontua uma vez por evento. Em `newsletter_clicked`, `value` é o filtro opcional "URL contém".',
      }),
    operator: z.enum(RULE_OPERATORS),
    value: z.string().nullable(),
    points: z.number().int().meta({ example: 20 }),
    active: z.boolean(),
    includeWelcome: z.boolean().meta({
      description:
        'Só para `newsletter_opened` e `newsletter_clicked`: também pontua os e-mails da série de boas-vindas (padrão: ligado).',
    }),
    position: z.number(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmLeadRoutingRuleDTO = dto(
  'CrmLeadRoutingRule',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    field: z.enum(RULE_FIELDS),
    operator: z.enum(RULE_OPERATORS),
    value: z.string().nullable(),
    ownerId: z
      .string()
      .meta({ description: 'Usuário que recebe os leads que casam.' }),
    active: z.boolean(),
    position: z.number(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmLeadWithContactAttemptDTO = z.object({
  lead: CrmLeadDTO,
  attempt: CrmLeadContactAttemptDTO,
})

export const CrmLeadWithQualificationDTO = z.object({
  lead: CrmLeadDTO,
  qualification: CrmLeadQualificationDTO,
})

export const CrmLeadWithMeetingDTO = z.object({
  lead: CrmLeadDTO,
  meeting: CrmLeadMeetingDTO,
})

export const CrmLeadWithPresentationDTO = z.object({
  lead: CrmLeadDTO,
  presentation: CrmLeadProposalPresentationDTO,
})
