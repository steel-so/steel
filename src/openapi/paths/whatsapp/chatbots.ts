import { z } from 'zod'
import {
  CreateWhatsAppChatbotSchema,
  ListWhatsAppChatbotSessionsSchema,
  SetWhatsAppChatbotStatusSchema,
  SimulateWhatsAppChatbotSchema,
  UpdateWhatsAppChatbotSchema,
} from '@/src/schemas/whatsapp-chatbot.schema'
import type { RouteConfig } from '../../registry'
import {
  WhatsAppChatbotDTO,
  WhatsAppChatbotFlowIssueDTO,
  WhatsAppChatbotListItemDTO,
  WhatsAppChatbotNodeStatsDTO,
  WhatsAppChatbotPublishDTO,
  WhatsAppChatbotSessionDTO,
  WhatsAppChatbotSimulationDTO,
} from '../../schemas/whatsapp'
import { MEMBER, MEMBER_ERRORS, PRIVILEGED, PRIVILEGED_ERRORS } from './shared'

const TAG = 'Comunicação · Chatbots' as const
const BOT_PARAMS = { chatbotId: 'Id do chatbot.' }

/**
 * Chatbots (Z2) — `app/api/workspaces/[id]/whatsapp/chatbots/**`. Leitura
 * para qualquer membro do módulo; criar, editar, publicar, simular e excluir
 * são de OWNER/ADMIN.
 */
export const chatbotRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/chatbots',
    tags: [TAG],
    summary: 'Listar chatbots',
    description: `Chatbots do workspace, do mais novo para o mais antigo, com o resumo dos últimos 30 dias de sessões. ${MEMBER}`,
    responses: {
      200: {
        description: 'Chatbots.',
        schema: z.array(WhatsAppChatbotListItemDTO),
      },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/chatbots',
    tags: [TAG],
    summary: 'Criar chatbot',
    description: `Cria um chatbot em **rascunho** a partir de um modelo (\`blank\`, \`menu\` ou \`lead-capture\`). Até 20 por workspace. Auditado. ${PRIVILEGED}`,
    body: CreateWhatsAppChatbotSchema,
    responses: {
      201: { description: 'Chatbot criado.', schema: WhatsAppChatbotDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'WHATSAPP_CONNECTION_NOT_FOUND',
      'WHATSAPP_CHATBOT_LIMIT_REACHED',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}',
    tags: [TAG],
    summary: 'Obter chatbot',
    description: `Inclui o rascunho do fluxo. ${MEMBER}`,
    params: BOT_PARAMS,
    responses: {
      200: { description: 'Chatbot.', schema: WhatsAppChatbotDTO },
    },
    errors: [...MEMBER_ERRORS, 'WHATSAPP_CHATBOT_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}',
    tags: [TAG],
    summary: 'Atualizar chatbot',
    description: `Atualização parcial. \`flow\` substitui o **rascunho**; o fluxo em execução só muda ao publicar. Gatilho, palavras-chave e conexão valem na hora. Auditado. ${PRIVILEGED}`,
    params: BOT_PARAMS,
    body: UpdateWhatsAppChatbotSchema,
    responses: {
      200: { description: 'Chatbot atualizado.', schema: WhatsAppChatbotDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'WHATSAPP_CHATBOT_NOT_FOUND',
      'WHATSAPP_CONNECTION_NOT_FOUND',
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}',
    tags: [TAG],
    summary: 'Excluir chatbot',
    description: `Apaga o chatbot e o histórico de sessões. Conversas em andamento deixam de ser conduzidas por ele. Auditado. ${PRIVILEGED}`,
    params: BOT_PARAMS,
    responses: { 200: { description: 'Chatbot excluído.', schema: null } },
    errors: [...PRIVILEGED_ERRORS, 'WHATSAPP_CHATBOT_NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}/publish',
    tags: [TAG],
    summary: 'Publicar o fluxo',
    description: `Valida o rascunho (início único e ligado, saídas de menu e condição com destino, sem ciclo que nunca espera o cliente, equipes e atendentes existentes), congela uma cópia como fluxo em execução e sobe a versão. Um chatbot em rascunho passa a **ACTIVE**; um pausado continua pausado. Sessões em andamento seguem na versão em que começaram. Auditado. ${PRIVILEGED}`,
    params: BOT_PARAMS,
    responses: {
      200: {
        description: 'Chatbot publicado e avisos que não bloqueiam.',
        schema: WhatsAppChatbotPublishDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'WHATSAPP_CHATBOT_NOT_FOUND',
      {
        code: 'WHATSAPP_CHATBOT_INVALID_FLOW',
        when: 'O rascunho tem erros (a mensagem aponta o primeiro)',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}/validate',
    tags: [TAG],
    summary: 'Verificar o rascunho',
    description: `Roda as mesmas checagens da publicação sem publicar e devolve erros e avisos por bloco. ${PRIVILEGED}`,
    params: BOT_PARAMS,
    responses: {
      200: {
        description: 'Problemas encontrados (lista vazia = tudo certo).',
        schema: z.array(WhatsAppChatbotFlowIssueDTO),
      },
    },
    errors: [...PRIVILEGED_ERRORS, 'WHATSAPP_CHATBOT_NOT_FOUND'],
  },
  {
    method: 'put',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}/status',
    tags: [TAG],
    summary: 'Ativar, pausar ou despublicar',
    description: `\`ACTIVE\` exige um fluxo já publicado. \`PAUSED\` e \`DRAFT\` impedem novas sessões; as em andamento terminam. Auditado. ${PRIVILEGED}`,
    params: BOT_PARAMS,
    body: SetWhatsAppChatbotStatusSchema,
    responses: {
      200: { description: 'Chatbot atualizado.', schema: WhatsAppChatbotDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'WHATSAPP_CHATBOT_NOT_FOUND',
      'WHATSAPP_CHATBOT_NOT_PUBLISHED',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}/simulate',
    tags: [TAG],
    summary: 'Simular o rascunho',
    description: `Executa um passo do **rascunho** sem enviar nada nem chamar integrações (os blocos de integração recebem uma resposta vazia de sucesso). Na primeira chamada omita \`state\`; nas seguintes devolva o \`state\` anterior e a resposta do "cliente" em \`input\` (texto, ou o id do botão, ex.: \`bot:menu:vendas\`). ${PRIVILEGED}`,
    params: BOT_PARAMS,
    body: SimulateWhatsAppChatbotSchema,
    responses: {
      200: {
        description: 'Mensagens que o bot enviaria e o novo estado.',
        schema: WhatsAppChatbotSimulationDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VALIDATION_ERROR',
      'WHATSAPP_CHATBOT_NOT_FOUND',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}/sessions',
    tags: [TAG],
    summary: 'Listar sessões',
    description: `Execuções recentes do chatbot (mais novas primeiro), com contato, desfecho e variáveis coletadas. Filtre por \`status\`; \`limit\` vai de 1 a 100 (padrão 30). ${MEMBER}`,
    params: BOT_PARAMS,
    query: ListWhatsAppChatbotSessionsSchema,
    responses: {
      200: {
        description: 'Sessões.',
        schema: z.array(WhatsAppChatbotSessionDTO),
      },
    },
    errors: [
      ...MEMBER_ERRORS,
      'VALIDATION_ERROR',
      'WHATSAPP_CHATBOT_NOT_FOUND',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/chatbots/{chatbotId}/stats',
    tags: [TAG],
    summary: 'Métricas por bloco',
    description: `Quantas vezes cada bloco do fluxo foi alcançado (entradas) e quantas vezes a conversa seguiu adiante (saídas) nos últimos 30 dias. A diferença entre as duas é onde as conversas ficaram, foram entregues a uma pessoa ou desistiram. Blocos sem passagem não aparecem. O editor mostra os números sobre o desenho. ${MEMBER}`,
    params: BOT_PARAMS,
    responses: {
      200: {
        description: 'Métricas por bloco.',
        schema: WhatsAppChatbotNodeStatsDTO,
      },
    },
    errors: [...MEMBER_ERRORS, 'WHATSAPP_CHATBOT_NOT_FOUND'],
  },
]
