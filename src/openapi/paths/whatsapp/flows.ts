import { z } from 'zod'
import {
  CreateWhatsAppFlowSchema,
  CreateWhatsAppFlowTemplateSchema,
  ListWhatsAppFlowResponsesSchema,
  PublishWhatsAppFlowSchema,
  SendWhatsAppFlowSchema,
  UpdateWhatsAppFlowSchema,
} from '@/src/schemas/whatsapp-flow.schema'
import type { RouteConfig } from '../../registry'
import { WhatsAppTemplateDTO } from '../../schemas/whatsapp'
import {
  WhatsAppFlowDTO,
  WhatsAppFlowListItemDTO,
  WhatsAppFlowMetaJsonDTO,
  WhatsAppFlowPreviewDTO,
  WhatsAppFlowPublishDTO,
  WhatsAppFlowResponsesPageDTO,
  WhatsAppFlowSendDTO,
} from '../../schemas/whatsapp-flows'
import { MEMBER, MEMBER_ERRORS, PRIVILEGED, PRIVILEGED_ERRORS } from './shared'

const TAG = 'Comunicação · Formulários (Flows)' as const
const FLOW_PARAMS = { flowId: 'Id do formulário (Flow).' }

/**
 * WhatsApp Flows (Z3) — `app/api/workspaces/[id]/whatsapp/flows/**`. Leitura
 * para qualquer membro do módulo; criar, editar, publicar e excluir são de
 * OWNER/ADMIN; enviar na conversa exige a permissão de enviar mensagens.
 */
export const flowRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/flows',
    tags: [TAG],
    summary: 'Listar formulários (Flows)',
    description: `Formulários do workspace, com quantos foram enviados e respondidos. ${MEMBER}`,
    responses: {
      200: {
        description: 'Formulários.',
        schema: z.array(WhatsAppFlowListItemDTO),
      },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/flows',
    tags: [TAG],
    summary: 'Criar formulário (Flow)',
    description: `Cria um formulário em **rascunho** a partir de um modelo (\`BLANK\`, \`SIGN_UP\`, \`APPOINTMENT\`, \`SURVEY\`) ou copiando um formulário do CRM (\`crmFormId\`: campos, mapeamento e ação). Só conexões da API oficial da Meta. Até 50 por workspace. Auditado. ${PRIVILEGED}`,
    body: CreateWhatsAppFlowSchema,
    responses: {
      201: { description: 'Formulário criado.', schema: WhatsAppFlowDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'BAD_REQUEST',
      'WHATSAPP_CONNECTION_NOT_FOUND',
      'WHATSAPP_FLOW_INVALID',
      'WHATSAPP_FLOW_LIMIT_REACHED',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}',
    tags: [TAG],
    summary: 'Obter formulário (Flow)',
    description: MEMBER,
    params: FLOW_PARAMS,
    responses: {
      200: { description: 'Formulário.', schema: WhatsAppFlowDTO },
    },
    errors: [...MEMBER_ERRORS, 'WHATSAPP_FLOW_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}',
    tags: [TAG],
    summary: 'Atualizar formulário (Flow)',
    description: `Atualização parcial das telas, textos e da ação no CRM. A Meta só recebe a mudança ao enviar o rascunho ou publicar. Formulário descontinuado não é editável. Auditado. ${PRIVILEGED}`,
    params: FLOW_PARAMS,
    body: UpdateWhatsAppFlowSchema,
    responses: {
      200: { description: 'Formulário atualizado.', schema: WhatsAppFlowDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'WHATSAPP_FLOW_NOT_FOUND',
      'WHATSAPP_FLOW_INVALID',
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}',
    tags: [TAG],
    summary: 'Excluir formulário (Flow)',
    description: `Só enquanto o formulário nunca foi enviado; com respostas coletadas use a descontinuação. Auditado. ${PRIVILEGED}`,
    params: FLOW_PARAMS,
    responses: { 200: { description: 'Excluído.' } },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'WHATSAPP_FLOW_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}/publish',
    tags: [TAG],
    summary: 'Enviar à Meta / publicar',
    description: `Converte as telas no Flow JSON e envia à Meta. Com \`publish: false\` só grava o rascunho lá (dá para testar o envio); com \`true\` (padrão) publica. Um Flow já publicado não pode ser editado na Meta: um novo Flow assume e as respostas às mensagens antigas continuam sendo reconhecidas. A recusa da Meta volta em \`WHATSAPP_FLOW_META_REJECTED\`. Auditado. ${PRIVILEGED}`,
    params: FLOW_PARAMS,
    body: PublishWhatsAppFlowSchema,
    responses: {
      200: { description: 'Resultado.', schema: WhatsAppFlowPublishDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'BAD_REQUEST',
      'WHATSAPP_FLOW_NOT_FOUND',
      'WHATSAPP_FLOW_INVALID',
      'WHATSAPP_FLOW_META_REJECTED',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}/deprecate',
    tags: [TAG],
    summary: 'Descontinuar formulário (Flow)',
    description: `Tira o formulário de uso (na Meta também, se estava publicado). As respostas coletadas continuam guardadas. Auditado. ${PRIVILEGED}`,
    params: FLOW_PARAMS,
    responses: {
      200: {
        description: 'Formulário descontinuado.',
        schema: WhatsAppFlowDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'WHATSAPP_FLOW_NOT_FOUND',
      'WHATSAPP_FLOW_META_REJECTED',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}/meta-json',
    tags: [TAG],
    summary: 'Ver o Flow JSON',
    description: `O JSON que seria enviado à Meta a partir das telas salvas. ${MEMBER}`,
    params: FLOW_PARAMS,
    responses: {
      200: { description: 'Flow JSON.', schema: WhatsAppFlowMetaJsonDTO },
    },
    errors: [...MEMBER_ERRORS, 'WHATSAPP_FLOW_NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}/preview',
    tags: [TAG],
    summary: 'Link de pré-visualização da Meta',
    description: `Consulta a Meta pelo link de pré-visualização do Flow enviado. ${PRIVILEGED}`,
    params: FLOW_PARAMS,
    responses: {
      200: { description: 'Pré-visualização.', schema: WhatsAppFlowPreviewDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'BAD_REQUEST',
      'WHATSAPP_FLOW_NOT_FOUND',
      'WHATSAPP_FLOW_NOT_SENDABLE',
      'WHATSAPP_FLOW_META_REJECTED',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}/template',
    tags: [TAG],
    summary: 'Criar template com o formulário',
    description: `Envia à Meta um template (corpo + botão do Flow) para o formulário publicado, que permite enviar fora das 24 horas. Fica na lista de templates e só envia depois de aprovado. Auditado. ${PRIVILEGED}`,
    params: FLOW_PARAMS,
    body: CreateWhatsAppFlowTemplateSchema,
    responses: {
      201: { description: 'Template criado.', schema: WhatsAppTemplateDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'BAD_REQUEST',
      'WHATSAPP_FLOW_NOT_FOUND',
      'WHATSAPP_FLOW_NOT_SENDABLE',
      'WHATSAPP_FLOW_META_REJECTED',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}/send',
    tags: [TAG],
    summary: 'Enviar o formulário numa conversa',
    description:
      'Manda o formulário como mensagem interativa (janela de 24 horas) ou, com `templateName` e `language`, por um template aprovado com o botão do Flow. A resposta do contato chega no webhook, é guardada, preenche o contato e cria o registro do CRM conforme a ação do formulário. Exige a permissão de enviar mensagens; a conversa precisa estar na conexão do formulário. Auditado.',
    params: FLOW_PARAMS,
    body: SendWhatsAppFlowSchema,
    responses: {
      201: { description: 'Enviado.', schema: WhatsAppFlowSendDTO },
    },
    errors: [
      ...MEMBER_ERRORS,
      'VALIDATION_ERROR',
      'WHATSAPP_FLOW_NOT_FOUND',
      'WHATSAPP_FLOW_NOT_SENDABLE',
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_PROVIDER_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/flows/{flowId}/responses',
    tags: [TAG],
    summary: 'Listar envios e respostas',
    description: `Envios do formulário (mais novos primeiro) com o contato, as respostas e o que foi criado no CRM. Paginação por \`cursor\`; \`limit\` vai de 1 a 100 (padrão 30). ${MEMBER}`,
    params: FLOW_PARAMS,
    query: ListWhatsAppFlowResponsesSchema,
    responses: {
      200: {
        description: 'Página de respostas.',
        schema: WhatsAppFlowResponsesPageDTO,
      },
    },
    errors: [...MEMBER_ERRORS, 'VALIDATION_ERROR', 'WHATSAPP_FLOW_NOT_FOUND'],
  },
]
