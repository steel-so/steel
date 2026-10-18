import { z } from 'zod'
import { KNOWLEDGE_SOURCE_TYPES } from '@/src/lib/ai/knowledge/sources'
import { dto } from '../common'

/** DTOs do Steel AI (`types/steel-ai.d.ts`). */

const dateTime = () => z.iso.datetime()
const AiModule = z.enum(['SERVICE_DESK', 'CRM', 'COMMUNICATION'])
const AiMode = z.enum(['EXPLORE', 'AGENT', 'AUTOPILOT', 'TEST']).meta({
  description:
    '`EXPLORE` = Ask (só leitura), `AGENT` = Build (escritas confirmadas), `AUTOPILOT` = escritas executam na hora, `TEST` = Teste (leituras reais, toda escrita é simulada no servidor — nada é alterado nem enviado).',
})

const AiChatModel = z.object({
  key: z.string().meta({ example: 'openai:gpt-4o-mini' }),
  provider: z.enum(['openai', 'anthropic']),
  providerLabel: z.string().meta({ example: 'OpenAI' }),
  label: z.string().meta({ example: 'GPT-4o mini' }),
  inputUsdPer1M: z.number().meta({
    description: 'US$ por 1M tokens de entrada (preço do provedor × margem).',
  }),
  outputUsdPer1M: z.number().meta({
    description: 'US$ por 1M tokens de saída (preço do provedor × margem).',
  }),
})

export const AiCapabilitiesDTO = dto(
  'AiCapabilities',
  z.object({
    aiEnabled: z.boolean().meta({
      description:
        'Interruptor geral do Steel AI. Desligado, as demais rotas respondem `AI_DISABLED`.',
    }),
    agentModeEnabled: z.boolean().meta({
      description:
        'Interruptor do workspace para o modo agente (ferramentas de escrita).',
    }),
    autopilotEnabled: z.boolean().meta({
      description:
        'Modo Autopilot liberado (exige também o modo agente). Padrão: desligado.',
    }),
    modules: z.array(AiModule).meta({
      description:
        'Módulos habilitados — as ferramentas que o Steel AI alcança.',
    }),
    modelKey: z.string().nullable().meta({
      description:
        'Modelo padrão de uma conversa nova (`<provider>:<model>`; preferência do usuário → padrão do workspace). `null` sem modelo utilizável.',
      example: 'openai:gpt-4o-mini',
    }),
    models: z.array(AiChatModel).meta({
      description:
        'Modelos que o usuário pode escolher na conversa (habilitados e com provedor configurado).',
    }),
    attachments: z.object({
      maxPerMessage: z.number().int(),
      maxImageBytes: z.number().int(),
      maxDocumentBytes: z.number().int(),
      accept: z.array(z.string()),
    }),
    quota: z.object({ usedUsd: z.number(), quotaUsd: z.number() }),
  }),
)

export const AiConversationDTO = dto(
  'AiConversation',
  z
    .object({
      id: z.string().meta({ example: 'ckw1aicv0000ab7d3k1e5xyz' }),
      title: z.string().nullable(),
      mode: AiMode,
      modelKey: z.string().nullable(),
      pinnedAt: dateTime().nullable(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Conversa com o Steel AI (privada do usuário).' }),
)

const AiSimulatedAction = z
  .object({
    kind: z.enum(['CREATE', 'UPDATE', 'DELETE', 'ACTION']),
    preview: z.object({
      title: z.string(),
      summary: z.string(),
      fields: z
        .array(
          z.object({
            label: z.string(),
            before: z.string().nullable().optional(),
            after: z.string().nullable().optional(),
          }),
        )
        .optional(),
      target: z
        .object({
          type: z.string(),
          id: z.string().optional(),
          label: z.string(),
          href: z.string().optional(),
        })
        .optional(),
    }),
  })
  .meta({
    description:
      'Modo `TEST`: a escrita que teria rodado, montada a partir da prévia da ferramenta. Nada foi alterado.',
  })

const AiToolCallDTO = z.object({
  id: z.string(),
  name: z.string().meta({ example: 'ws_overview' }),
  label: z.string().meta({ example: 'Consultando o workspace' }),
  module: AiModule.nullable(),
  status: z.enum([
    'running',
    'done',
    'error',
    'pending_confirmation',
    'simulated',
  ]),
  summary: z.string().optional(),
  memory: z
    .object({
      id: z.string(),
      scope: z.enum(['WORKSPACE', 'PERSONAL']),
      content: z.string(),
      action: z.enum(['saved', 'duplicate', 'forgotten']),
    })
    .optional()
    .meta({
      description:
        'Só nas ferramentas de memória (`memory_save`, `memory_forget`): o fato salvo/esquecido, para o chip "Memória salva" com desfazer.',
    }),
  simulation: AiSimulatedAction.optional(),
  citations: z
    .array(
      z.object({
        sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES),
        label: z.string().meta({ example: 'Página da Wiki' }),
        title: z.string(),
        href: z.string().meta({ example: '/demo/wiki/clx1' }),
      }),
    )
    .optional()
    .meta({
      description:
        'Só em `steel_search`: as fontes encontradas, mostradas como links abaixo da resposta.',
    }),
})

export const AiPendingActionDTO = dto(
  'AiPendingAction',
  z
    .object({
      id: z.string(),
      conversationId: z.string().nullable(),
      agentRunId: z.string().nullable(),
      toolName: z.string().meta({ example: 'crm_create_task' }),
      kind: z.enum(['CREATE', 'UPDATE', 'DELETE', 'ACTION']),
      module: AiModule.nullable(),
      preview: z.object({
        title: z.string(),
        summary: z.string(),
        fields: z
          .array(
            z.object({
              label: z.string(),
              before: z.string().nullable().optional(),
              after: z.string().nullable().optional(),
            }),
          )
          .optional(),
        target: z
          .object({
            type: z.string(),
            id: z.string().optional(),
            label: z.string(),
            href: z.string().optional(),
          })
          .optional(),
      }),
      status: z.enum(['PENDING', 'EXECUTED', 'FAILED', 'CANCELED', 'EXPIRED']),
      requiresDoubleConfirm: z.boolean().meta({
        description: 'Exclusões: confirme com `doubleConfirmed: true`.',
      }),
      autoExecuted: z.boolean().meta({
        description:
          'Executada na hora pelo modo Autopilot (nunca ficou pendente).',
      }),
      resultSummary: z.string().nullable(),
      error: z.string().nullable(),
      expiresAt: dateTime(),
      decidedAt: dateTime().nullable(),
      executedAt: dateTime().nullable(),
      createdAt: dateTime(),
    })
    .meta({
      description:
        'Escrita proposta pelo Steel AI que só executa depois da confirmação humana.',
    }),
)

export const AiAttachmentDTO = dto(
  'AiAttachment',
  z
    .object({
      id: z.string(),
      conversationId: z.string(),
      messageId: z.string().nullable().meta({
        description: '`null` até uma mensagem ser enviada com o anexo.',
      }),
      kind: z.enum(['IMAGE', 'DOCUMENT']),
      filename: z.string().meta({ example: 'contrato.pdf' }),
      contentType: z.string().meta({ example: 'application/pdf' }),
      sizeBytes: z.number().int(),
      url: z.string().meta({
        description: 'Rota de mesma origem que serve o arquivo ao dono.',
      }),
      createdAt: dateTime(),
    })
    .meta({ description: 'Arquivo ou foto enviado ao Steel AI.' }),
)

export const AiMessageDTO = dto(
  'AiMessage',
  z.object({
    id: z.string(),
    conversationId: z.string(),
    role: z.enum(['USER', 'ASSISTANT']),
    content: z.string(),
    toolCalls: z.array(AiToolCallDTO),
    pendingActions: z.array(AiPendingActionDTO),
    attachments: z.array(AiAttachmentDTO),
    createdAt: dateTime(),
  }),
)
