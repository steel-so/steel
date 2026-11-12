import { z } from 'zod'
import { dto } from '../common'

/**
 * Contacts blocked on a WhatsApp number (zap-block-contacts). Zod version of
 * `types/whatsapp-contact-block.d.ts`, only for the documentation.
 */

const Provider = z.enum(['META', 'ZAPI', 'WIDGET'])

export const WhatsAppContactBlockDTO = dto(
  'WhatsAppContactBlock',
  z.object({
    id: z.string(),
    connectionId: z.string(),
    connectionLabel: z.string(),
    connectionPhoneNumber: z.string(),
    provider: Provider,
    contactId: z.string().nullable(),
    contactName: z.string().nullable(),
    waId: z.string().meta({
      description:
        'Telefone (só dígitos) ou, para contato só com username, o BSUID.',
      example: '5511999990000',
    }),
    hasPhone: z.boolean(),
    reason: z.string().nullable().meta({ description: 'Até 500 caracteres.' }),
    providerStatus: z.enum(['APPLIED', 'PENDING', 'FAILED']).meta({
      description:
        '`APPLIED`: bloqueado também na Meta/Z-API. `PENDING`: a Meta só bloqueia quem escreveu nas últimas 24 h — vai para a Meta quando a pessoa escrever. `FAILED`: o provedor recusou (`providerError`). Em todos os casos o bloqueio vale no Steel.',
    }),
    providerError: z.string().nullable(),
    appliedAt: z.iso.datetime().nullable(),
    origin: z.enum(['STEEL', 'PROVIDER']).meta({
      description:
        '`PROVIDER`: importado pela sincronização da lista de bloqueio da Meta.',
    }),
    droppedCount: z.number().int().meta({
      description: 'Mensagens do contato ignoradas desde o bloqueio.',
    }),
    lastDroppedAt: z.iso.datetime().nullable(),
    blockedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
    blockedAt: z.iso.datetime(),
  }),
)

export const WhatsAppConversationBlockStateDTO = dto(
  'WhatsAppConversationBlockState',
  z.object({
    conversationId: z.string(),
    connectionId: z.string(),
    provider: Provider,
    supported: z.boolean().meta({
      description: 'Falso no chat do site (não há número para bloquear).',
    }),
    block: WhatsAppContactBlockDTO.nullable(),
    canBlock: z.boolean(),
    canUnblock: z.boolean(),
  }),
)

export const WhatsAppContactBlockResultDTO = dto(
  'WhatsAppContactBlockResult',
  z.object({
    block: WhatsAppContactBlockDTO,
    notice: z.string().meta({
      description: 'Resumo em pt-BR do que aconteceu no provedor.',
    }),
  }),
)

export const WhatsAppContactUnblockResultDTO = dto(
  'WhatsAppContactUnblockResult',
  z.object({
    id: z.string(),
    providerWarning: z.string().nullable().meta({
      description:
        'Preenchido quando o Steel desbloqueou mas o provedor recusou: a pessoa pode continuar bloqueada no app/na Meta.',
    }),
  }),
)

export const WhatsAppContactBlockSyncDTO = dto(
  'WhatsAppContactBlockSync',
  z.object({
    connections: z.array(
      z.object({
        connectionId: z.string(),
        label: z.string(),
        provider: Provider,
        imported: z.number().int(),
        retried: z.number().int(),
        applied: z.number().int(),
        listSupported: z.boolean().meta({
          description:
            'Falso na Z-API: ela não tem endpoint que liste os bloqueados.',
        }),
        error: z.string().nullable(),
      }),
    ),
  }),
)
