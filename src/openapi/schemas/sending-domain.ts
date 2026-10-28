import { z } from 'zod'
import {
  SENDING_DOMAIN_REGIONS,
  SENDING_DOMAIN_STATUSES,
  SendingDomainRecordSchema,
  SUGGESTED_DMARC_VALUE,
} from '@/src/schemas/sending-domain.schema'

/** DTOs of the CRM newsletter sending domains (ADR 0054). */

export const SendingDomainDmarcDTO = z.object({
  name: z.string().meta({ example: '_dmarc.acme.com.br' }),
  found: z.boolean().nullable().meta({
    description:
      '`true`: há registro DMARC; `false`: não há; `null`: a consulta falhou ou passou do tempo (desconhecido).',
  }),
  value: z.string().nullable(),
  suggested: z.string().meta({ example: SUGGESTED_DMARC_VALUE }),
})

export const SendingDomainDTO = z.object({
  id: z.string(),
  name: z.string().meta({ example: 'news.acme.com.br' }),
  status: z.enum(SENDING_DOMAIN_STATUSES),
  region: z.enum(SENDING_DOMAIN_REGIONS),
  records: z.array(SendingDomainRecordSchema).meta({
    description:
      'Registros DNS pedidos pelo Resend (SPF, DKIM, rastreamento), com o status de cada um.',
  }),
  failureReason: z.string().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  newslettersCount: z.number().int().meta({
    description: 'Newsletters ativas que enviam deste domínio.',
  }),
  createdAt: z.iso.datetime(),
  dmarc: SendingDomainDmarcDTO.optional().meta({
    description:
      'Só no detalhe (e nas respostas de cadastro e verificação): DMARC do domínio raiz.',
  }),
})
