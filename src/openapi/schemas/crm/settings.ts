import { z } from 'zod'
import { CrmLeadOpenStageEnum } from '@/src/schemas/crm-settings.schema'
import { dto } from '../../common'

/** DTOs de configurações e membros do CRM (`types/crm-settings.d.ts`, `types/crm-member.d.ts`). */

export const CrmSettingsDTO = dto(
  'CrmSettings',
  z.object({
    workspaceId: z.string(),
    leadReopenStage: CrmLeadOpenStageEnum.meta({
      description: 'Etapa para onde um lead perdido volta ao ser reaberto.',
    }),
    proposalValidityDays: z.number().int().meta({
      description: 'Validade padrão (dias) das propostas novas.',
      example: 15,
    }),
    notifyProposalExpiry: z.boolean().meta({
      description: 'Avisar o responsável por e-mail quando a proposta expira.',
    }),
    isDefault: z.boolean().meta({
      description:
        '`true` enquanto o workspace nunca salvou configurações (valores padrão).',
    }),
    updatedById: z.string().nullable(),
    updatedAt: z.iso.datetime().nullable(),
  }),
)

export const CrmMemberDTO = dto(
  'CrmMember',
  z
    .object({
      id: z.string().meta({ example: 'ckv9x2p0h0000us7d3k1e5abc' }),
      name: z.string().meta({ example: 'Maria Souza' }),
      email: z.string().meta({ example: 'maria@acme.com.br' }),
      image: z.string().nullable(),
    })
    .meta({ description: 'Membro do workspace, para atribuição no CRM.' }),
)

export const CrmRetentionSettingsDTO = dto(
  'CrmRetentionSettings',
  z.object({
    workspaceId: z.string(),
    onDetractor: z.boolean().meta({
      description:
        'Uma resposta detratora (NPS/CSAT) cria uma tarefa de retenção para o responsável da conta.',
    }),
    onHealthDrop: z.boolean().meta({
      description:
        'Uma queda de saúde do cliente cria uma tarefa de retenção para o responsável da conta.',
    }),
    onSlaBreach: z.boolean().meta({
      description:
        'Um SLA violado no ServiceDesk, de um cliente que é uma empresa do CRM, cria uma tarefa de retenção para o responsável da conta.',
    }),
    createOpportunity: z.boolean().meta({
      description: 'Abre também uma oportunidade de retenção.',
    }),
    taskDueDays: z.number().int().meta({
      description: 'Prazo da tarefa, em dias.',
      example: 2,
    }),
    isDefault: z.boolean().meta({
      description:
        '`true` enquanto o workspace nunca salvou as regras (valores padrão).',
    }),
    updatedById: z.string().nullable(),
    updatedAt: z.iso.datetime().nullable(),
  }),
)
