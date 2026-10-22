import { z } from 'zod'
import {
  CreateWhatsAppContactSchema,
  FindOrCreateWhatsAppContactSchema,
  ListWhatsAppContactsSchema,
  UpdateWhatsAppContactBroadcastOptOutSchema,
  UpdateWhatsAppContactSchema,
} from '@/src/schemas/whatsapp-contact.schema'
import { ImportWhatsAppContactsSchema } from '@/src/schemas/whatsapp-contact-import.schema'
import { StartWhatsAppNumberValidationSchema } from '@/src/schemas/whatsapp-number-validation.schema'
import type { RouteConfig } from '../../registry'
import {
  WhatsAppContactDTO,
  WhatsAppContactImportResultDTO,
  WhatsAppNumberValidationDTO,
} from '../../schemas/whatsapp'
import {
  CONTACT_PARAM,
  PRIVILEGED,
  PRIVILEGED_ERRORS,
  perm,
  permErrors,
} from './shared'

const TAG = 'Comunicação · Contatos' as const
const BASE = '/workspaces/{id}/whatsapp/contacts/{contactId}'
const PARAMS = { contactId: CONTACT_PARAM }

export const contactRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/contacts',
    tags: [TAG],
    summary: 'Listar contatos',
    description: `Contatos do workspace em ordem alfabética, com o número de conversas. \`search\` filtra por nome (sem diferenciar maiúsculas) ou trecho do número. \`whatsapp\` (\`yes\` | \`no\` | \`unknown\`) filtra pelo resultado da checagem "tem WhatsApp?". Sem paginação. ${perm('contacts', 'VIEW')}`,
    query: ListWhatsAppContactsSchema,
    responses: {
      200: { description: 'Contatos.', schema: z.array(WhatsAppContactDTO) },
    },
    errors: permErrors('contacts', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/contacts',
    tags: [TAG],
    summary: 'Criar contato',
    description: `Cadastra um contato pelo número (\`waId\`, só dígitos com DDI e DDD). Auditado. ${perm('contacts', 'CREATE')}`,
    body: CreateWhatsAppContactSchema,
    responses: {
      201: { description: 'Contato criado.', schema: WhatsAppContactDTO },
    },
    errors: [
      ...permErrors('contacts', 'CREATE'),
      {
        code: 'CONFLICT',
        message: 'Este contato já existe',
        when: 'Já existe contato com este número no workspace',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/contacts/import',
    tags: [TAG],
    summary: 'Importar contatos (CSV)',
    description: `Importa contatos de uma planilha CSV (conteúdo em \`csv\`, separado por \`,\` ou \`;\`, até 1000 linhas e 1 MB). Colunas: \`Telefone\` (obrigatória, DDI + DDD + número, 10–15 dígitos), \`Nome\` e \`Descrição\` (opcionais). Telefone repetido na planilha é recusado; contato que já existe no workspace é atualizado (célula em branco não apaga dado) e nunca duplicado. Linhas inválidas voltam em \`rejected\` sem abortar a importação. Auditado. ${perm('contacts', 'CREATE')}`,
    consent: true,
    body: ImportWhatsAppContactsSchema,
    responses: {
      200: {
        description: 'Resultado da importação.',
        schema: WhatsAppContactImportResultDTO,
      },
    },
    errors: [
      ...permErrors('contacts', 'CREATE'),
      {
        code: 'BAD_REQUEST',
        message: 'A planilha precisa ter a coluna "Telefone".',
        when: 'CSV sem a coluna de telefone, vazio ou com mais de 1000 linhas',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/contacts/find-or-create',
    tags: [TAG],
    summary: 'Buscar ou criar contato',
    description: `Upsert pelo número: devolve o contato existente com esse \`waId\` ou cria um novo — útil para iniciar conversa a partir de um número digitado. ${perm('contacts', 'CREATE')}`,
    body: FindOrCreateWhatsAppContactSchema,
    responses: {
      200: {
        description: 'Contato existente ou recém-criado.',
        schema: WhatsAppContactDTO,
      },
    },
    errors: permErrors('contacts', 'CREATE'),
  },
  {
    method: 'patch',
    path: BASE,
    tags: [TAG],
    summary: 'Atualizar contato',
    description: `Atualização parcial de nome, avatar e descrição. Campo omitido = sem alteração; \`null\` ou \`""\` apaga o valor. O número não muda. Auditado. ${perm('contacts', 'EDIT')}`,
    params: PARAMS,
    body: UpdateWhatsAppContactSchema,
    responses: {
      200: { description: 'Contato atualizado.', schema: WhatsAppContactDTO },
    },
    errors: [...permErrors('contacts', 'EDIT'), 'WHATSAPP_CONTACT_NOT_FOUND'],
  },
  {
    method: 'delete',
    path: BASE,
    tags: [TAG],
    summary: 'Excluir contato',
    description: `Exclui o contato e, em cascata, suas conversas (com as mensagens) e participações em transmissões. Auditado. ${perm('contacts', 'DELETE')}`,
    params: PARAMS,
    responses: { 200: { description: 'Contato excluído.', schema: null } },
    errors: [...permErrors('contacts', 'DELETE'), 'WHATSAPP_CONTACT_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${BASE}/sync-avatar`,
    tags: [TAG],
    summary: 'Sincronizar foto de perfil',
    description: `Busca a foto de perfil do contato no WhatsApp e salva em \`avatarUrl\`. Usa a primeira conexão **Z-API** do workspace — a API oficial da Meta não expõe fotos de contatos. Sem corpo. ${perm('contacts', 'EDIT')}`,
    params: PARAMS,
    responses: {
      200: { description: 'Contato com a foto.', schema: WhatsAppContactDTO },
    },
    errors: [
      ...permErrors('contacts', 'EDIT'),
      'WHATSAPP_CONTACT_NOT_FOUND',
      {
        code: 'WHATSAPP_CONTACT_PHOTO_UNAVAILABLE',
        message:
          'Buscar foto de perfil exige uma conexão Z-API — a API oficial da Meta não expõe fotos de contato',
        when: 'Workspace sem conexão Z-API',
      },
      {
        code: 'WHATSAPP_CONTACT_PHOTO_UNAVAILABLE',
        message: 'Este contato não tem foto de perfil disponível no WhatsApp',
        when: 'Contato sem foto (ou foto privada)',
      },
      { code: 'WHATSAPP_PROVIDER_ERROR', when: 'Falha na consulta à Z-API' },
    ],
  },
  {
    method: 'put',
    path: `${BASE}/broadcast-opt-out`,
    tags: [TAG],
    summary: 'Descadastrar/reinscrever em transmissões (LGPD)',
    description: `Opt-out LGPD das transmissões, operado pelo admin (origem \`ADMIN\`). Descadastrar (\`optedOut: true\`) é livre — ex.: pedido por telefone ou e-mail. **Reinscrever** (\`optedOut: false\`) só a pedido explícito do próprio contato: exige \`contactRequested: true\` (senão \`422\`), e o opt-out anterior fica registrado na auditoria. Contatos descadastrados são pulados (\`SKIPPED\`) nos disparos. Auditado (\`opt_out\`/\`opt_in\`). ${PRIVILEGED}`,
    params: PARAMS,
    body: UpdateWhatsAppContactBroadcastOptOutSchema,
    responses: {
      200: { description: 'Contato atualizado.', schema: WhatsAppContactDTO },
    },
    errors: [...PRIVILEGED_ERRORS, 'WHATSAPP_CONTACT_NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/number-validations',
    tags: [TAG],
    summary: 'Validar se os números têm WhatsApp',
    description: `Checagem "tem WhatsApp?" para higiene de base (**não** é uma pré-checagem a cada mensagem: a Z-API já valida no envio). Escolha a origem em \`scope\`: \`CONTACTS\` (\`contactIds\` ou \`all\`, até 20.000), \`BROADCAST\` (\`broadcastId\`) ou \`AI_CAMPAIGN\` (\`campaignId\`). Só funciona com uma conexão **Z-API** conectada — a API oficial da Meta não tem endpoint equivalente e nunca é chamada. Contatos com resultado recente (TTL em \`whatsappCheckTtlDays\`, padrão 30 dias) não são consultados de novo, a menos que \`force: true\`. Até 200 contatos terminam na própria chamada; acima disso vira um job em segundo plano e o progresso sai em \`GET .../number-validations/{validationId}\`. Uma validação por vez por workspace. Não consome limite do plano (não envia mensagem). Os números nunca são gravados no log nem na auditoria. Auditado. ${perm('contacts', 'EDIT')}`,
    body: StartWhatsAppNumberValidationSchema,
    responses: {
      201: {
        description: 'Validação criada (ou já concluída, se pequena).',
        schema: WhatsAppNumberValidationDTO,
      },
    },
    errors: [
      ...permErrors('contacts', 'EDIT'),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
      'WHATSAPP_BROADCAST_NOT_FOUND',
      'WHATSAPP_AI_CAMPAIGN_NOT_FOUND',
      'WHATSAPP_CONNECTION_NOT_FOUND',
      {
        code: 'CONFLICT',
        when: 'Já há uma validação em andamento, a seleção está vazia ou passa de 20.000 contatos',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/number-validations/{validationId}',
    tags: [TAG],
    summary: 'Consultar o progresso de uma validação',
    description: `Estado e contadores de uma validação "tem WhatsApp?" (a tela consulta por polling). ${perm('contacts', 'VIEW')}`,
    params: { validationId: 'Id da validação "tem WhatsApp?".' },
    responses: {
      200: { description: 'Validação.', schema: WhatsAppNumberValidationDTO },
    },
    errors: [
      ...permErrors('contacts', 'VIEW'),
      'WHATSAPP_VALIDATION_NOT_FOUND',
    ],
  },
]
