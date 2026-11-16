import { z } from 'zod'
import {
  CreateCrmCompanySchema,
  ReorderCrmCompaniesSchema,
  UpdateCrmCompanySchema,
} from '@/src/schemas/crm-company.schema'
import {
  CreateCrmCustomFieldSchema,
  ListCrmCustomFieldsSchema,
  ReorderCrmCustomFieldsSchema,
  SetCrmCustomFieldValueSchema,
  UpdateCrmCustomFieldSchema,
} from '@/src/schemas/crm-custom-field.schema'
import {
  CreateCrmPersonSchema,
  ListCrmPeopleSchema,
  ReorderCrmPeopleSchema,
  UpdateCrmPersonSchema,
} from '@/src/schemas/crm-person.schema'
import type { ErrorSpec, RouteConfig } from '../../registry'
import {
  CrmCompanyDTO,
  CrmCustomFieldDefinitionDTO,
  CrmCustomFieldValueDTO,
  CrmPersonDTO,
} from '../../schemas/crm/people'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · Pessoas e empresas — `people`, `companies`, `custom-fields`,
 * `custom-field-values`.
 */

const TAG = 'CRM · Pessoas e empresas' as const

const PERSON_PARAM = { personId: 'ID da pessoa.' }
const COMPANY_PARAM = { companyId: 'ID da empresa.' }
const DEFINITION_PARAM = {
  definitionId: 'ID da definição de campo customizado.',
}
const RECORD_PARAM =
  'ID do registro dono do valor (empresa, pessoa ou oportunidade).'

const PERSON_NOT_FOUND = notFoundError(
  'CrmPerson',
  'Pessoa inexistente ou de outro workspace',
)
const COMPANY_NOT_FOUND = notFoundError(
  'CrmCompany',
  'Empresa inexistente ou de outro workspace',
)
const DEFINITION_NOT_FOUND = notFoundError(
  'CrmCustomFieldDefinition',
  'Definição inexistente, excluída ou de outro workspace',
)
const CUSTOM_FIELD_INVALID: ErrorSpec = {
  code: 'CRM_CUSTOM_FIELD_INVALID',
  message: '"Segmento": opção inválida',
  when: 'Valor de `customFields` incompatível com o tipo, fora das opções ou obrigatório vazio',
}
const COMPANY_CONFLICT: ErrorSpec = {
  code: 'CRM_COMPANY_CONFLICT',
  when: 'Domínio ou CNPJ já usado por outra empresa do workspace',
}

const CUSTOM_FIELDS_NOTE =
  '`customFields` é um mapa `definitionId → valor` (não `cf_<id>`); chaves que não correspondem a definições ativas da entidade são ignoradas. Os valores são convertidos pelo tipo da definição (`NUMBER`, `DATE` → ISO, `BOOLEAN`, `SELECT` precisa estar em `options`). A resposta traz os valores achatados em `customFields` (`cf_<definitionId>`).'

const CLEARABLE_NOTE =
  'Atualização parcial: campos omitidos não mudam; textos opcionais aceitam `null` (ou `""`) para apagar o valor.'

const REORDER_NOTE =
  'Grava a ordem manual da grade: cada ID em `orderedIds` recebe `position` igual ao seu índice. IDs de outro workspace fazem a transação falhar (`500 DATABASE_ERROR`).'

const SIDE_EFFECTS_NOTE =
  'Registra a atividade na linha do tempo e dispara os workflows com gatilho de registro correspondente.'

export const crmPeopleRoutes: RouteConfig[] = [
  /* -------------------------------- pessoas ------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/people',
    tags: [TAG],
    summary: 'Listar pessoas',
    description: describe(
      'Pessoas do workspace (excluídas ficam de fora), na ordem manual (`position`), com os valores de campos customizados.',
      crmAccess('people', 'VIEW'),
    ),
    query: ListCrmPeopleSchema.extend({
      companyId: ListCrmPeopleSchema.shape.companyId.meta({
        description: 'Só as pessoas vinculadas a esta empresa.',
      }),
    }),
    responses: {
      200: { description: 'Pessoas.', schema: z.array(CrmPersonDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/people',
    tags: [TAG],
    summary: 'Criar pessoa',
    description: describe(
      CUSTOM_FIELDS_NOTE,
      SIDE_EFFECTS_NOTE,
      crmAccess('people', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmPersonSchema,
      example: {
        name: 'Carlos Lima',
        emails: ['carlos@empresa.com.br'],
        phones: ['+5511999990000'],
        jobTitle: 'Gerente de TI',
        companyId: 'ckw1comp0000ab7d3k1e5xyz',
      },
    },
    responses: {
      201: { description: 'Pessoa criada.', schema: CrmPersonDTO },
    },
    errors: [...CRM_ERRORS, CUSTOM_FIELD_INVALID],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/people/reorder',
    tags: [TAG],
    summary: 'Reordenar pessoas',
    description: describe(REORDER_NOTE, crmAccess('people', 'EDIT')),
    consent: true,
    body: ReorderCrmPeopleSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/people/{personId}',
    tags: [TAG],
    summary: 'Detalhe da pessoa',
    description: crmAccess('people', 'VIEW'),
    params: PERSON_PARAM,
    responses: { 200: { description: 'Pessoa.', schema: CrmPersonDTO } },
    errors: [...CRM_ERRORS, PERSON_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/people/{personId}',
    tags: [TAG],
    summary: 'Atualizar pessoa',
    description: describe(
      CLEARABLE_NOTE,
      '`companyId: null` desvincula a empresa.',
      CUSTOM_FIELDS_NOTE,
      SIDE_EFFECTS_NOTE,
      crmAccess('people', 'EDIT'),
    ),
    consent: true,
    params: PERSON_PARAM,
    body: UpdateCrmPersonSchema,
    responses: {
      200: { description: 'Pessoa atualizada.', schema: CrmPersonDTO },
    },
    errors: [...CRM_ERRORS, PERSON_NOT_FOUND, CUSTOM_FIELD_INVALID],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/people/{personId}',
    tags: [TAG],
    summary: 'Excluir pessoa',
    description: describe(
      'Exclusão lógica (`deletedAt`): a pessoa some das listagens.',
      SIDE_EFFECTS_NOTE,
      crmAccess('people', 'DELETE'),
    ),
    consent: true,
    params: PERSON_PARAM,
    responses: { 200: { description: 'Pessoa excluída.', schema: null } },
    errors: [...CRM_ERRORS, PERSON_NOT_FOUND],
  },

  /* ------------------------------- empresas ------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/companies',
    tags: [TAG],
    summary: 'Listar empresas',
    description: describe(
      'Empresas do workspace (excluídas ficam de fora), na ordem manual (`position`), com os valores de campos customizados.',
      crmAccess('companies', 'VIEW'),
    ),
    query: {
      type: 'object',
      properties: {
        icp: {
          type: 'string',
          enum: ['true', 'false'],
          description:
            '`true` só empresas no ICP; `false` só fora do ICP; omitido, todas. Qualquer valor diferente de `true` conta como `false`.',
        },
      },
    },
    responses: {
      200: { description: 'Empresas.', schema: z.array(CrmCompanyDTO) },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        message: 'Parâmetros inválidos',
        when: 'Query inválida',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/companies',
    tags: [TAG],
    summary: 'Criar empresa',
    description: describe(
      'Domínio e CNPJ são únicos por workspace.',
      'Com um CNPJ válido, a criação consulta a Receita e preenche o que ficou em branco (razão social, fantasia, CNAE, porte, natureza jurídica, situação, abertura, capital, endereço, e-mails, telefones e domínio); o que foi enviado sempre prevalece. Se a consulta falhar, a empresa é criada normalmente só com os dados enviados. Campos de registro (`legalName`, `tradeName`, `emails`, `phones`, `cnaeCode`, `cnaeDescription`, `size`, `legalNature`, `registrationStatus`, `openedAt`, `shareCapital`) também podem ser enviados.',
      CUSTOM_FIELDS_NOTE,
      SIDE_EFFECTS_NOTE,
      crmAccess('companies', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmCompanySchema,
      example: {
        name: 'Empresa Exemplo Ltda',
        cnpj: '12.345.678/0001-90',
        domain: 'empresa.com.br',
        employees: 120,
        icp: true,
        address: { city: 'São Paulo', state: 'SP', country: 'Brasil' },
        emails: ['contato@empresa.com.br'],
        phones: ['(11) 2395-8400'],
        size: 'EPP',
        openedAt: '2015-03-02',
      },
    },
    responses: {
      201: { description: 'Empresa criada.', schema: CrmCompanyDTO },
    },
    errors: [...CRM_ERRORS, COMPANY_CONFLICT, CUSTOM_FIELD_INVALID],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/companies/reorder',
    tags: [TAG],
    summary: 'Reordenar empresas',
    description: describe(REORDER_NOTE, crmAccess('companies', 'EDIT')),
    consent: true,
    body: ReorderCrmCompaniesSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/companies/{companyId}',
    tags: [TAG],
    summary: 'Detalhe da empresa',
    description: crmAccess('companies', 'VIEW'),
    params: COMPANY_PARAM,
    responses: { 200: { description: 'Empresa.', schema: CrmCompanyDTO } },
    errors: [...CRM_ERRORS, COMPANY_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/companies/{companyId}',
    tags: [TAG],
    summary: 'Atualizar empresa',
    description: describe(
      CLEARABLE_NOTE,
      '`address`, `employees`, `arr` e `accountOwnerId` também aceitam `null`.',
      CUSTOM_FIELDS_NOTE,
      SIDE_EFFECTS_NOTE,
      crmAccess('companies', 'EDIT'),
    ),
    consent: true,
    params: COMPANY_PARAM,
    body: UpdateCrmCompanySchema,
    responses: {
      200: { description: 'Empresa atualizada.', schema: CrmCompanyDTO },
    },
    errors: [
      ...CRM_ERRORS,
      COMPANY_NOT_FOUND,
      COMPANY_CONFLICT,
      CUSTOM_FIELD_INVALID,
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/companies/{companyId}',
    tags: [TAG],
    summary: 'Excluir empresa',
    description: describe(
      'Exclusão lógica (`deletedAt`): a empresa some das listagens.',
      SIDE_EFFECTS_NOTE,
      crmAccess('companies', 'DELETE'),
    ),
    consent: true,
    params: COMPANY_PARAM,
    responses: { 200: { description: 'Empresa excluída.', schema: null } },
    errors: [...CRM_ERRORS, COMPANY_NOT_FOUND],
  },

  /* --------------------------- campos customizados ------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/custom-fields',
    tags: [TAG],
    summary: 'Listar campos customizados',
    description: describe(
      'Definições ativas, na ordem manual (`position`).',
      crmAccess('custom-fields', 'VIEW'),
    ),
    query: ListCrmCustomFieldsSchema,
    responses: {
      200: {
        description: 'Definições.',
        schema: z.array(CrmCustomFieldDefinitionDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/custom-fields',
    tags: [TAG],
    summary: 'Criar campo customizado',
    description: describe(
      '`key` (snake_case) é única por entidade no workspace.',
      crmAccess('custom-fields', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmCustomFieldSchema,
      example: {
        entity: 'COMPANY',
        key: 'segmento',
        label: 'Segmento',
        type: 'SELECT',
        options: ['SMB', 'Mid-market', 'Enterprise'],
        required: false,
      },
    },
    responses: {
      201: {
        description: 'Definição criada.',
        schema: CrmCustomFieldDefinitionDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_CUSTOM_FIELD_CONFLICT',
        when: 'Já existe a mesma `key` para a entidade',
      },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/custom-fields/reorder',
    tags: [TAG],
    summary: 'Reordenar campos customizados',
    description: describe(REORDER_NOTE, crmAccess('custom-fields', 'EDIT')),
    consent: true,
    body: ReorderCrmCustomFieldsSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/custom-fields/{definitionId}',
    tags: [TAG],
    summary: 'Atualizar campo customizado',
    description: describe(
      'Atualização parcial. `entity` e `key` são imutáveis. Valores já gravados não são reconvertidos ao mudar `type`/`options`.',
      crmAccess('custom-fields', 'EDIT'),
    ),
    consent: true,
    params: DEFINITION_PARAM,
    body: UpdateCrmCustomFieldSchema,
    responses: {
      200: {
        description: 'Definição atualizada.',
        schema: CrmCustomFieldDefinitionDTO,
      },
    },
    errors: [...CRM_ERRORS, DEFINITION_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/custom-fields/{definitionId}',
    tags: [TAG],
    summary: 'Excluir campo customizado',
    description: describe(
      'Exclusão lógica: a definição some das listagens e seus valores deixam de ser aceitos na escrita.',
      crmAccess('custom-fields', 'DELETE'),
    ),
    consent: true,
    params: DEFINITION_PARAM,
    responses: { 200: { description: 'Definição excluída.', schema: null } },
    errors: [...CRM_ERRORS, DEFINITION_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/custom-fields/{definitionId}/values/{recordId}',
    tags: [TAG],
    summary: 'Definir valor de campo customizado',
    description: describe(
      'Grava (upsert) o valor de uma definição para um registro — edição célula a célula da grade. O valor é salvo como enviado (sem a conversão por tipo do `customFields` do create/update); `null` limpa.',
      'Acesso: sessão + membro do workspace com o módulo **CRM** habilitado, a permissão `custom-fields` × `VIEW` e a permissão `EDIT` na entidade dona da definição (`companies`, `people` ou `opportunities`); OWNER/ADMIN sempre passam.',
    ),
    consent: true,
    params: { ...DEFINITION_PARAM, recordId: RECORD_PARAM },
    body: { schema: SetCrmCustomFieldValueSchema, example: { value: 'SMB' } },
    responses: {
      200: { description: 'Valor gravado.', schema: CrmCustomFieldValueDTO },
    },
    errors: [...CRM_ERRORS, DEFINITION_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/custom-field-values/{recordId}',
    tags: [TAG],
    summary: 'Valores customizados de um registro',
    description: describe(
      'Todos os valores de campos customizados gravados para o registro (um por definição).',
      crmAccess('custom-fields', 'VIEW'),
    ),
    params: { recordId: RECORD_PARAM },
    responses: {
      200: {
        description: 'Valores.',
        schema: z.array(CrmCustomFieldValueDTO),
      },
    },
    errors: CRM_ERRORS,
  },
]
