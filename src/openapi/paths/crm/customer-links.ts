import { z } from 'zod'
import {
  CustomerLinkStateQuerySchema,
  LinkCustomerSchema,
  ResolveCustomerQuerySchema,
  UnlinkCustomerQuerySchema,
} from '@/src/schemas/customer-link.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CustomerLinkStateDTO,
  ResolvedCustomerDTO,
} from '../../schemas/crm/customer-links'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Cadastro único (ADR 0066): vínculo opcional entre cliente/contato do
 * ServiceDesk e do WhatsApp e a empresa/pessoa do CRM.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Pessoas e empresas']
const BASE = '/workspaces/{id}/crm/customer-links'

const SOURCE_NOT_FOUND: ErrorEntry = {
  code: 'CUSTOMER_LINK_SOURCE_NOT_FOUND',
  when: 'O cliente ou contato de origem não existe no workspace',
}
const TARGET_NOT_FOUND: ErrorEntry = {
  code: 'CUSTOMER_LINK_TARGET_NOT_FOUND',
  when: 'A empresa ou pessoa do CRM escolhida não existe no workspace',
}

const ACCESS =
  'Também exige acesso ao módulo de origem: agente do **ServiceDesk** (`sd-customers`/`sd-contacts`) ou **Comunicação** (`contacts`).'

export const crmCustomerLinkRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/suggestions`,
    tags: TAGS,
    summary: 'Ver o vínculo de um cadastro e as sugestões',
    description: describe(
      'Mostra a qual empresa (cliente do ServiceDesk) ou pessoa (contato do ServiceDesk ou do WhatsApp) do CRM o cadastro está ligado e quem mais combina por CNPJ, nome, e-mail ou telefone.',
      crmAccess('people', 'VIEW'),
      ACCESS,
    ),
    query: CustomerLinkStateQuerySchema,
    responses: {
      200: {
        description: 'Vínculo atual e sugestões.',
        schema: CustomerLinkStateDTO,
      },
    },
    errors: [...CRM_ERRORS, SOURCE_NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/resolve`,
    tags: TAGS,
    summary: 'Ver o mesmo cliente no CRM, ServiceDesk e WhatsApp',
    description: describe(
      'Resolve um identificador (`companyId`, `personId`, `sdCustomerId`, `cnpj` ou `phone`; vale o primeiro presente) para os cadastros ligados nos três módulos. O vínculo gravado vence; sem vínculo, vale o casamento por CNPJ, nome, e-mail ou telefone (`origin: fallback`). As partes do ServiceDesk e do WhatsApp só vêm se o usuário tem acesso a esses módulos.',
      crmAccess('companies', 'VIEW'),
    ),
    query: ResolveCustomerQuerySchema,
    responses: {
      200: { description: 'Cadastros ligados.', schema: ResolvedCustomerDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: BASE,
    tags: TAGS,
    summary: 'Vincular um cadastro ao CRM',
    description: describe(
      'Liga o cliente do ServiceDesk a uma empresa do CRM, ou o contato do ServiceDesk/WhatsApp a uma pessoa do CRM (`targetId`). Substitui o vínculo anterior.',
      crmAccess('people', 'EDIT'),
      ACCESS,
    ),
    consent: true,
    body: {
      schema: LinkCustomerSchema,
      example: { kind: 'sd-customer', id: 'clx1abc', targetId: 'clx2def' },
    },
    responses: {
      200: {
        description: 'Vínculo gravado.',
        schema: z.object({ linked: z.literal(true) }),
      },
    },
    errors: [...CRM_ERRORS, SOURCE_NOT_FOUND, TARGET_NOT_FOUND],
  },
  {
    method: 'delete',
    path: BASE,
    tags: TAGS,
    summary: 'Desfazer o vínculo de um cadastro',
    description: describe(
      'Remove o vínculo gravado. O casamento por CNPJ, nome, e-mail ou telefone continua valendo como reserva.',
      crmAccess('people', 'EDIT'),
      ACCESS,
    ),
    consent: true,
    query: UnlinkCustomerQuerySchema,
    responses: {
      200: {
        description: 'Vínculo removido.',
        schema: z.object({ linked: z.literal(false) }),
      },
    },
    errors: [...CRM_ERRORS, SOURCE_NOT_FOUND],
  },
]
