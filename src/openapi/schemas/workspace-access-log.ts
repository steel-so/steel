import { z } from 'zod'

/** DTOs of the IP-restricted workspace entry log (`types/workspace-access-log.d.ts`). */

export const WorkspaceAccessLogListDTO = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      userId: z.string().nullable().meta({
        description: 'Mantido mesmo depois que o usuário é excluído.',
      }),
      userEmail: z
        .string()
        .nullable()
        .meta({ description: 'E-mail do usuário no momento da tentativa.' }),
      userName: z
        .string()
        .nullable()
        .meta({ description: 'Nome do usuário no momento da tentativa.' }),
      ip: z
        .string()
        .nullable()
        .meta({ description: 'IP de origem; `null` quando desconhecido.' }),
      userAgent: z.string().nullable(),
      outcome: z.enum(['ALLOWED', 'BLOCKED']),
      surface: z
        .enum(['APP', 'API'])
        .meta({ description: '`APP`: páginas do app; `API`: chamadas à API.' }),
      path: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  period: z.object({
    from: z.string().meta({ example: '2026-09-28' }),
    to: z.string().meta({ example: '2026-10-27' }),
    timezone: z.literal('America/Sao_Paulo'),
  }),
  allowedIps: z.array(z.string()).meta({
    description:
      'Allowlist atual do workspace (vazia = sem restrição e nada é registrado).',
  }),
})
