import { z } from 'zod'
import { dto } from '../../common'

/** DTOs da visão Clientes (CRM > Fidelizar > Clientes). */

export const CrmCustomerRowDTO = dto(
  'CrmCustomerRowDTO',
  z.object({
    kind: z.enum(['COMPANY', 'PERSON']),
    id: z.string().meta({ description: 'ID da empresa ou da pessoa.' }),
    name: z.string(),
    subtitle: z.string().nullable().meta({
      description: 'Domínio da empresa; empresa da pessoa.',
    }),
    deals: z.number().int().meta({ description: 'Negócios ganhos.' }),
    totalWon: z.number().meta({ example: 48000 }),
    averageTicket: z.number().meta({ example: 12000 }),
    firstWonAt: z.iso.datetime().nullable(),
    lastWonAt: z.iso.datetime().nullable(),
    nextRenewalAt: z.iso.datetime().nullable().meta({
      description:
        'Fim do contrato ativo mais próximo (o da empresa, para uma pessoa).',
    }),
    ownerId: z.string().nullable(),
    ownerName: z.string().nullable(),
    health: z
      .object({
        level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        score: z.number().int().meta({ description: '0-100, 100 = saudável.' }),
      })
      .nullable(),
  }),
)

export const CrmCustomersPageDTO = dto(
  'CrmCustomersPageDTO',
  z.object({
    items: z.array(CrmCustomerRowDTO),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    totals: z.object({
      customers: z.number().int(),
      revenue: z.number(),
      deals: z.number().int(),
      averageTicket: z.number(),
    }),
  }),
)

export const CrmCustomerOptionsDTO = dto(
  'CrmCustomerOptionsDTO',
  z.object({
    pipelines: z.array(z.object({ id: z.string(), name: z.string() })),
    products: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
)
