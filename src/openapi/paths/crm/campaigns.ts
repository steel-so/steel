import { z } from 'zod'
import {
  ControlCrmCampaignSchema,
  CreateCrmCampaignSchema,
  CrmCampaignAudiencePreviewSchema,
  CrmCampaignTestSendSchema,
  LaunchCrmCampaignSchema,
  ListCrmCampaignRecipientsQuerySchema,
  UpdateCrmCampaignSchema,
} from '@/src/schemas/crm-campaign.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmCampaignAudiencePreviewDTO,
  CrmCampaignDetailDTO,
  CrmCampaignEmailPreviewDTO,
  CrmCampaignListItemDTO,
  CrmCampaignOptionsDTO,
  CrmCampaignRecipientPageDTO,
  CrmCampaignStatsDTO,
  CrmCampaignTestSendResultDTO,
} from '../../schemas/crm/campaigns'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Campanhas multicanal (ADR 0025) — assistente de 4 passos (destino,
 * conteúdo, público, revisar e enviar), WhatsApp como integração opcional,
 * funil por canal e conversões no destino. Tudo sob a permissão `email`;
 * os links de rastreio e o webhook do Resend são públicos.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Campanhas']
const PUBLIC_TAGS: RouteConfig['tags'] = ['CRM público · Campanhas']
const CAMPAIGN_ID = 'ID da campanha.'
const BASE = '/workspaces/{id}/crm/campaigns'

const NOT_FOUND: ErrorEntry = {
  code: 'CRM_CAMPAIGN_NOT_FOUND',
  when: 'Campanha inexistente no workspace',
}
const LOCKED: ErrorEntry = {
  code: 'CRM_CAMPAIGN_LOCKED',
  when: 'Campanha já lançada (ou transição inválida)',
}

export const crmCampaignRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAGS,
    summary: 'Listar campanhas',
    description: describe(
      'Campanhas do workspace com os indicadores (enviados, abertos, cliques, WhatsApp e conversões) e os links de cada canal.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: {
        description: 'Campanhas.',
        schema: z.array(CrmCampaignListItemDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: BASE,
    tags: TAGS,
    summary: 'Criar campanha (rascunho)',
    description: describe(
      'Cria o rascunho com o nome; o `slug` (valor de `utm_campaign`) é gerado e fica fixo.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmCampaignSchema,
      example: { name: 'Black Friday 2026' },
    },
    responses: {
      201: { description: 'Rascunho criado.', schema: CrmCampaignDetailDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/options`,
    tags: TAGS,
    summary: 'Opções do assistente',
    description: describe(
      'Landing pages, formulários, visuais de e-mail, listas e — se a Comunicação estiver ativa — as conexões de WhatsApp conectadas com os templates aprovados.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Opções.', schema: CrmCampaignOptionsDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/audience-preview`,
    tags: TAGS,
    summary: 'Alcance do público',
    description: describe(
      'Conta quantos contatos o público alcança por canal, já sem os descadastrados (LGPD) e sem quem não tem e-mail/WhatsApp. Nada é salvo.',
      crmAccess('email', 'VIEW'),
    ),
    body: CrmCampaignAudiencePreviewSchema,
    responses: {
      200: { description: 'Alcance.', schema: CrmCampaignAudiencePreviewDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/{campaignId}`,
    tags: TAGS,
    summary: 'Detalhe da campanha',
    description: describe(
      'Inclui `issues`: o que ainda impede o envio, por passo do assistente.',
      crmAccess('email', 'VIEW'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    responses: {
      200: { description: 'Campanha.', schema: CrmCampaignDetailDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/{campaignId}`,
    tags: TAGS,
    summary: 'Salvar rascunho',
    description: describe(
      'Atualização parcial de qualquer passo. Só em `DRAFT`. Ligar o WhatsApp exige a Comunicação ativa.',
      crmAccess('email', 'EDIT'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    body: UpdateCrmCampaignSchema,
    responses: {
      200: { description: 'Campanha.', schema: CrmCampaignDetailDTO },
    },
    errors: [
      ...CRM_ERRORS,
      NOT_FOUND,
      LOCKED,
      {
        code: 'CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE',
        when: 'Comunicação desligada',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'Registro referenciado de outro workspace',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/{campaignId}`,
    tags: TAGS,
    summary: 'Excluir campanha',
    description: describe(
      'Exclusão lógica. Campanhas agendadas, enviando ou pausadas precisam ser canceladas antes.',
      crmAccess('email', 'DELETE'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    responses: { 200: { description: 'Excluída.', schema: null } },
    errors: [...CRM_ERRORS, NOT_FOUND, LOCKED],
  },
  {
    method: 'post',
    path: `${BASE}/{campaignId}/launch`,
    tags: TAGS,
    summary: 'Enviar ou agendar',
    description: describe(
      'Valida os passos, tira o retrato do público (excluindo descadastrados), grava a base legal confirmada e enfileira o envio no worker (`crm-campaigns`): agora, ou em `scheduledAt` se futuro. O WhatsApp sai `whatsappDelayHours` depois do e-mail. O remetente do e-mail precisa ser de um domínio de envio verificado do workspace ou do domínio da plataforma (ADR 0055): fora disso entra em `issues` com `fix: SENDING_DOMAINS`, e uma campanha já agendada falha os e-mails no disparo, com aviso ao criador.',
      crmAccess('email', 'EDIT'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    consent: true,
    body: {
      schema: LaunchCrmCampaignSchema,
      example: { confirmLegalBasis: true },
    },
    responses: {
      200: { description: 'Campanha lançada.', schema: CrmCampaignDetailDTO },
    },
    errors: [
      ...CRM_ERRORS,
      NOT_FOUND,
      LOCKED,
      {
        code: 'CRM_CAMPAIGN_INCOMPLETE',
        when: 'Falta algo em algum passo (`details.issues`)',
      },
      {
        code: 'CRM_CAMPAIGN_NO_RECIPIENTS',
        when: 'Ninguém do público pode receber',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/{campaignId}/control`,
    tags: TAGS,
    summary: 'Pausar, retomar ou cancelar',
    description: describe(
      'Pausar mantém os envios pendentes; retomar volta a enfileirar; cancelar descarta o que falta (auditado).',
      crmAccess('email', 'EDIT'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    body: { schema: ControlCrmCampaignSchema, example: { action: 'pause' } },
    responses: {
      200: { description: 'Campanha.', schema: CrmCampaignDetailDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, LOCKED],
  },
  {
    method: 'post',
    path: `${BASE}/{campaignId}/test-send`,
    tags: TAGS,
    summary: 'Envio de teste',
    description: describe(
      'Envia o e-mail (assunto com "[Teste]") e, se ligado, o WhatsApp para um endereço de teste, sem rastreio.',
      crmAccess('email', 'EDIT'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    body: {
      schema: CrmCampaignTestSendSchema,
      example: { email: 'eu@acme.com.br' },
    },
    responses: {
      200: {
        description: 'Resultado por canal.',
        schema: CrmCampaignTestSendResultDTO,
      },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/{campaignId}/preview`,
    tags: TAGS,
    summary: 'Pré-visualizar e-mail',
    description: describe(
      'O e-mail renderizado para um contato de exemplo, com o link da campanha.',
      crmAccess('email', 'VIEW'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    responses: {
      200: { description: 'E-mail.', schema: CrmCampaignEmailPreviewDTO },
    },
    errors: [
      ...CRM_ERRORS,
      NOT_FOUND,
      { code: 'VALIDATION_ERROR', when: 'Campanha sem visual de e-mail' },
      { code: 'CRM_EMAIL_TEMPLATE_NOT_FOUND', when: 'Visual excluído' },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/{campaignId}/stats`,
    tags: TAGS,
    summary: 'Resultados da campanha',
    description: describe(
      'Funil do e-mail (enviados, entregues, abertos, cliques) e do WhatsApp (enviados, entregues, lidos, cliques, respostas), conversões no destino e os contatos convertidos.',
      crmAccess('email', 'VIEW'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    responses: {
      200: { description: 'Resultados.', schema: CrmCampaignStatsDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/{campaignId}/recipients`,
    tags: TAGS,
    summary: 'Contatos da campanha',
    description: describe(
      'Linha do tempo por contato (paginada, com busca por nome, e-mail ou telefone).',
      crmAccess('email', 'VIEW'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    query: ListCrmCampaignRecipientsQuerySchema,
    responses: {
      200: {
        description: 'Página de contatos.',
        schema: CrmCampaignRecipientPageDTO,
      },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },

  /* ------------------------------- públicas ------------------------------- */
  {
    method: 'get',
    path: '/crm/campaigns/c/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Link rastreado da campanha',
    description:
      'Marca o clique (e a abertura, no e-mail) e redireciona (302) para o destino com `utm_source`, `utm_medium`, `utm_campaign` e `stc` (o próprio token, para atribuir a conversão).',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado `<recipientId>-<e|w>.<assinatura>`.' },
    responses: {
      302: { description: 'Redireciona ao destino.', envelope: false },
    },
    errors: [
      {
        code: 'CRM_CAMPAIGN_LINK_INVALID',
        when: 'Token inválido ou destino removido',
      },
    ],
  },
  {
    method: 'get',
    path: '/crm/campaigns/o/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Pixel de abertura',
    description:
      'Imagem GIF 1×1 do e-mail; marca a primeira abertura. Sempre responde a imagem.',
    auth: 'public',
    rateLimit: false,
    params: { token: 'Token assinado do link de e-mail.' },
    responses: { 200: { description: 'GIF 1×1.', envelope: false } },
  },
  {
    method: 'post',
    path: '/crm/campaigns/resend-webhook',
    tags: PUBLIC_TAGS,
    summary: 'Webhook do Resend',
    description:
      'Eventos `email.delivered`, `email.opened`, `email.clicked`, `email.bounced` e `email.complained` das campanhas. Verificado pela assinatura Svix (`svix-id`, `svix-timestamp`, `svix-signature`) com `RESEND_WEBHOOK_SECRET`.',
    auth: 'public',
    rateLimit: false,
    body: {
      schema: z.object({
        type: z.string(),
        data: z.object({ email_id: z.string() }),
      }),
      example: { type: 'email.delivered', data: { email_id: 'em_123' } },
    },
    responses: {
      200: {
        description: 'Evento processado.',
        schema: z.object({ tracked: z.boolean() }),
      },
    },
    errors: [
      {
        code: 'UNAUTHORIZED',
        when: 'Assinatura ausente, inválida ou expirada',
      },
      {
        code: 'CRM_CAMPAIGN_WEBHOOK_NOT_CONFIGURED',
        when: '`RESEND_WEBHOOK_SECRET` não configurado',
      },
    ],
  },
]
