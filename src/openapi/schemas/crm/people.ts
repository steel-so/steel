import { z } from 'zod'
import { dto } from '../../common'

/**
 * DTOs de pessoas, empresas e campos customizados do CRM
 * (`types/crm-person.d.ts`, `types/crm-company.d.ts`,
 * `types/crm-custom-field.d.ts`).
 */

const dateTime = () => z.iso.datetime()

/** Valores customizados achatados, mesclados por `withCustomFields`. */
const customFields = () =>
  z.record(z.string(), z.unknown()).meta({
    description:
      'Valores dos campos customizados do registro, achatados com a chave `cf_<definitionId>` (vazio quando não há valores).',
    example: { cf_ckw1cfd0000ab7d3k1e5xyz: 'Enterprise' },
  })

export const CrmPersonDTO = dto(
  'CrmPerson',
  z
    .object({
      id: z.string().meta({ example: 'ckw1pers0000ab7d3k1e5xyz' }),
      name: z.string().meta({ example: 'Carlos Lima' }),
      emails: z.array(z.string()).meta({ example: ['carlos@empresa.com.br'] }),
      phones: z.array(z.string()).meta({ example: ['+5511999990000'] }),
      city: z.string().nullable(),
      jobTitle: z.string().nullable(),
      linkedin: z.string().nullable(),
      avatar: z.string().nullable(),
      companyId: z
        .string()
        .nullable()
        .meta({ description: 'Empresa vinculada (`null` = sem empresa).' }),
      workspaceId: z.string(),
      createdById: z.string(),
      updatedById: z.string().nullable(),
      position: z
        .number()
        .meta({ description: 'Ordem manual na grade (ver `reorder`).' }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
      customFields: customFields().optional(),
    })
    .meta({ description: 'Pessoa (contato) do CRM.' }),
)

export const CrmCompanyAddressDTO = dto(
  'CrmCompanyAddress',
  z.object({
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional().meta({ description: 'UF (2 letras).' }),
    zipCode: z.string().optional(),
    country: z.string().optional(),
  }),
)

export const CrmCompanyDTO = dto(
  'CrmCompany',
  z
    .object({
      id: z.string().meta({ example: 'ckw1comp0000ab7d3k1e5xyz' }),
      name: z.string().meta({ example: 'Empresa Exemplo Ltda' }),
      cnpj: z.string().nullable(),
      domain: z.string().nullable().meta({ example: 'empresa.com.br' }),
      employees: z.number().int().nullable(),
      linkedin: z.string().nullable(),
      address: CrmCompanyAddressDTO.nullable(),
      arr: z
        .number()
        .nullable()
        .meta({ description: 'Receita anual recorrente (ARR).' }),
      icp: z
        .boolean()
        .meta({ description: 'Empresa dentro do perfil de cliente ideal.' }),
      legalName: z
        .string()
        .nullable()
        .meta({ description: 'Razão social (Receita).' }),
      tradeName: z
        .string()
        .nullable()
        .meta({ description: 'Nome fantasia (Receita).' }),
      emails: z.array(z.string()).meta({
        description:
          'E-mails da empresa (união do que foi digitado e da Receita).',
      }),
      phones: z.array(z.string()).meta({
        description: 'Telefones da empresa, ex.: `(11) 2395-8400`.',
      }),
      cnaeCode: z.string().nullable().meta({ example: '4711302' }),
      cnaeDescription: z.string().nullable(),
      size: z
        .enum(['ME', 'EPP', 'DEMAIS'])
        .nullable()
        .meta({ description: 'Porte conforme a Receita.' }),
      legalNature: z.string().nullable(),
      registrationStatus: z
        .string()
        .nullable()
        .meta({ description: 'Situação cadastral, ex.: `ATIVA`.' }),
      openedAt: z
        .string()
        .nullable()
        .meta({ description: 'Início das atividades (`AAAA-MM-DD`).' }),
      shareCapital: z
        .number()
        .nullable()
        .meta({ description: 'Capital social.' }),
      workspaceId: z.string(),
      createdById: z.string(),
      accountOwnerId: z
        .string()
        .nullable()
        .meta({ description: 'Responsável pela conta (usuário).' }),
      updatedById: z.string().nullable(),
      position: z
        .number()
        .meta({ description: 'Ordem manual na grade (ver `reorder`).' }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
      customFields: customFields().optional(),
    })
    .meta({ description: 'Empresa (conta) do CRM.' }),
)

const CUSTOM_FIELD_ENTITIES = ['COMPANY', 'PERSON', 'OPPORTUNITY'] as const
const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
] as const

export const CrmCustomFieldDefinitionDTO = dto(
  'CrmCustomFieldDefinition',
  z
    .object({
      id: z.string().meta({ example: 'ckw1cfd0000ab7d3k1e5xyz' }),
      workspaceId: z.string(),
      entity: z.enum(CUSTOM_FIELD_ENTITIES).meta({
        description: 'Entidade que recebe o campo.',
      }),
      key: z.string().meta({ example: 'segmento' }),
      label: z.string().meta({ example: 'Segmento' }),
      type: z.enum(CUSTOM_FIELD_TYPES),
      options: z.array(z.string()).meta({
        description: 'Opções válidas quando `type` é `SELECT`.',
        example: ['SMB', 'Mid-market', 'Enterprise'],
      }),
      required: z.boolean(),
      position: z.number(),
      createdById: z.string(),
      updatedById: z.string().nullable(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Definição de campo customizado.' }),
)

export const CrmCustomFieldValueDTO = dto(
  'CrmCustomFieldValue',
  z.object({
    id: z.string(),
    definitionId: z.string(),
    recordId: z
      .string()
      .meta({ description: 'Empresa, pessoa ou oportunidade dona do valor.' }),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)
