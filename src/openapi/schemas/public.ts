import { z } from 'zod'
import {
  CrmFormFieldSchema,
  CrmFormPhaseSchema,
  FORM_ACTIONS,
} from '@/src/schemas/crm-form.schema'
import {
  CrmLandingPageSectionContentSchema,
  CrmLandingPageSectionTypeEnum,
} from '@/src/schemas/crm-landing-page-section.schema'
import {
  CrmProposalSectionContentSchema,
  CrmProposalSectionTypeEnum,
  CrmProposalStatusEnum,
} from '@/src/schemas/crm-proposal.schema'
import { CrmWorkflowRunOutputSchema } from '@/src/schemas/crm-workflow.schema'
import { dto } from '../common'

/** DTOs das páginas públicas do CRM e da API de leads (`types/crm-*.d.ts`). */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()

export const CrmFormPublicDTO = dto(
  'CrmFormPublic',
  z
    .object({
      id: z.string(),
      name: z.string().meta({ example: 'Solicite um orçamento' }),
      description: z.string().nullable(),
      fields: z.array(CrmFormFieldSchema).meta({
        description:
          'Campos na ordem de exibição. `key` é a chave usada em `values` no envio; `type` define o controle (checkbox → boolean, os demais → string).',
      }),
      phases: z.array(CrmFormPhaseSchema).meta({
        description:
          'Etapas do formulário multi-etapas (campos apontam para a fase em `phaseId`). Vazio = etapa única.',
      }),
      successMessage: z.string().nullable(),
      redirectUrl: z
        .string()
        .nullable()
        .meta({ description: 'Para onde levar o visitante após o envio.' }),
      newsletter: z
        .object({ name: z.string(), consentText: z.string() })
        .nullable()
        .optional()
        .meta({
          description:
            'Presente quando o formulário inscreve numa newsletter: mostrar a caixa opcional de consentimento com `consentText` e enviar `newsletterConsent: true` quando marcada (ADR 0054).',
        }),
    })
    .meta({ description: 'Formulário publicado, como o visitante o vê.' }),
)

export const CrmFormSubmissionDTO = dto(
  'CrmFormSubmission',
  z.object({
    id: z.string(),
    formId: z.string(),
    values: z.record(z.string(), z.union([z.string(), z.boolean()])),
    action: z.enum(FORM_ACTIONS).meta({
      description: 'O que o envio criou no CRM (pessoa, empresa ou lead).',
    }),
    createdPersonId: z.string().nullable(),
    createdCompanyId: z.string().nullable(),
    createdLeadId: z.string().nullable(),
    referrer: z.string().nullable(),
    createdAt: dateTime(),
  }),
)

export const CrmProposalPublicDTO = dto(
  'CrmProposalPublic',
  z
    .object({
      id: z.string(),
      name: z.string().meta({ example: 'Proposta — Implantação ServiceDesk' }),
      status: CrmProposalStatusEnum,
      validUntil: nullableDateTime(),
      isExpired: z
        .boolean()
        .meta({ description: 'Validade vencida — o aceite fica bloqueado.' }),
      canAccept: z.boolean().meta({
        description:
          'Pode ser aceita agora (enviada/vista e dentro da validade).',
      }),
      acceptedAt: nullableDateTime(),
      acceptedByName: z.string().nullable(),
      sections: z.array(
        z.object({
          id: z.string(),
          type: CrmProposalSectionTypeEnum,
          order: z.number().int(),
          enabled: z.boolean(),
          content: CrmProposalSectionContentSchema,
        }),
      ),
    })
    .meta({
      description: 'Proposta como o cliente a vê pelo link compartilhado.',
    }),
)

export const CrmLandingPagePublicDTO = dto(
  'CrmLandingPagePublic',
  z.object({
    title: z.string(),
    templateKey: z
      .string()
      .meta({ description: 'Template visual (catálogo fixo).' }),
    sections: z.array(
      z.object({
        id: z.string(),
        type: CrmLandingPageSectionTypeEnum,
        order: z.number().int(),
        enabled: z.boolean(),
        content: CrmLandingPageSectionContentSchema,
      }),
    ),
  }),
)

export const CrmLeadDTO = dto(
  'CrmLead',
  z.object({
    id: z.string().meta({ example: 'ckw1lead0000ab7d3k1e5xyz' }),
    workspaceId: z.string(),
    name: z.string().meta({ example: 'Carlos Lima' }),
    emails: z.array(z.string()).meta({ example: ['carlos@empresa.com.br'] }),
    phones: z.array(z.string()).meta({ example: ['+5511999990000'] }),
    company: z.string().nullable(),
    jobTitle: z.string().nullable(),
    city: z.string().nullable(),
    linkedin: z.string().nullable(),
    source: z.string().nullable().meta({ example: 'site' }),
    channel: z.string().nullable().meta({ example: 'API' }),
    stage: z.enum([
      'RECEIVED',
      'IN_CONTACT',
      'QUALIFIED',
      'OPPORTUNITY',
      'PROPOSAL',
      'CLOSED',
    ]),
    score: z
      .number()
      .int()
      .meta({ description: 'Pontuação pelas regras de score do workspace.' }),
    ownerId: z.string().nullable().meta({
      description:
        'Responsável definido pelas regras de roteamento (`null` = sem dono).',
    }),
    convertedPersonId: z.string().nullable(),
    closeResult: z.enum(['WON', 'LOST']).nullable(),
    closedAt: nullableDateTime(),
    contractSignedAt: nullableDateTime(),
    billingType: z.enum(['ONE_TIME', 'MONTHLY', 'YEARLY']).nullable(),
    closedAmount: z.number().nullable(),
    lostReason: z.string().nullable(),
    lostNote: z.string().nullable(),
    retryAt: nullableDateTime(),
    createdById: z.string(),
    updatedById: z.string().nullable(),
    position: z.number(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmWorkflowRunDTO = dto(
  'CrmWorkflowRun',
  CrmWorkflowRunOutputSchema,
)
