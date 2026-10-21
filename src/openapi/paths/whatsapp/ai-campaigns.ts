import { z } from 'zod'
import {
  CreateWhatsAppAiCampaignSchema,
  QueueWhatsAppAiCampaignSchema,
  UpdateWhatsAppAiCampaignSchema,
} from '@/src/schemas/whatsapp-ai-campaign.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  WhatsAppAiCampaignActionRunDTO,
  WhatsAppAiCampaignDTO,
  WhatsAppAiCampaignRecipientPageDTO,
} from '../../schemas/whatsapp'
import { perm, permErrors } from './shared'

const TAG = 'Comunicação · Campanhas de IA' as const
const BASE = '/workspaces/{id}/whatsapp/ai-campaigns'
const ITEM = `${BASE}/{campaignId}`
const PARAMS = { campaignId: 'Id da campanha de IA.' }

const NOT_FOUND: ErrorEntry = {
  code: 'WHATSAPP_AI_CAMPAIGN_NOT_FOUND',
  when: 'Campanha inexistente, arquivada ou de outro workspace',
}
const RUNNING: ErrorEntry = {
  code: 'WHATSAPP_AI_CAMPAIGN_RUNNING',
  when: 'A campanha está enviando — pause antes',
}

export const aiCampaignRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: [TAG],
    summary: 'Listar campanhas de IA',
    description: `Campanhas do workspace (as arquivadas ficam de fora), mais novas primeiro, com o funil (\`stats\`) e o que falta para iniciar (\`problems\`). ${perm('broadcasts', 'VIEW')}`,
    responses: {
      200: {
        description: 'Campanhas.',
        schema: z.array(WhatsAppAiCampaignDTO),
      },
    },
    errors: permErrors('broadcasts', 'VIEW'),
  },
  {
    method: 'post',
    path: BASE,
    tags: [TAG],
    summary: 'Criar campanha de IA',
    description: `Cria a campanha como rascunho (\`DRAFT\`); o resto (conexão, template, variáveis, instruções, ações, ritmo) vem por \`PATCH\`. Auditado. ${perm('broadcasts', 'CREATE')}`,
    body: CreateWhatsAppAiCampaignSchema,
    responses: {
      201: { description: 'Campanha criada.', schema: WhatsAppAiCampaignDTO },
    },
    errors: permErrors('broadcasts', 'CREATE'),
  },
  {
    method: 'get',
    path: ITEM,
    tags: [TAG],
    summary: 'Campanha de IA',
    description: `Campanha com o funil e o que falta para iniciar. ${perm('broadcasts', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: { description: 'Campanha.', schema: WhatsAppAiCampaignDTO },
    },
    errors: [...permErrors('broadcasts', 'VIEW'), NOT_FOUND],
  },
  {
    method: 'patch',
    path: ITEM,
    tags: [TAG],
    summary: 'Atualizar campanha de IA',
    description: `Atualização parcial. **Qualquer template** da conexão é aceito: cada variável (cabeçalho, corpo e parâmetro de botão de link) diz de onde vem o valor — texto fixo (\`FIXED\`), campo do contato (\`CONTACT\`: primeiro nome, nome, telefone, descrição) ou coluna da planilha importada (\`COLUMN\`), com um valor reserva opcional. Conexão, template, variáveis e mídia do cabeçalho só mudam com a campanha parada; trocar o template zera as variáveis. Nome, objetivo, instruções, ações, \`intervalSeconds\` (20–60 s) e \`aiReplies\` mudam a qualquer momento e valem no próximo envio/resposta. As ações precisam apontar para membros, equipes e status de fechamento existentes. Auditado. ${perm('broadcasts', 'EDIT')}`,
    params: PARAMS,
    body: UpdateWhatsAppAiCampaignSchema,
    responses: {
      200: {
        description: 'Campanha atualizada.',
        schema: WhatsAppAiCampaignDTO,
      },
    },
    errors: [
      ...permErrors('broadcasts', 'EDIT'),
      NOT_FOUND,
      RUNNING,
      'WHATSAPP_CONNECTION_NOT_FOUND',
      'WHATSAPP_TEMPLATE_NOT_FOUND',
      {
        code: 'VALIDATION_ERROR',
        when: 'Template de outra conexão, ou ação apontando para membro/equipe/status inexistente',
      },
    ],
  },
  {
    method: 'delete',
    path: ITEM,
    tags: [TAG],
    summary: 'Arquivar campanha de IA',
    description: `Para o envio e arquiva a campanha; as conversas continuam com o histórico. Auditado. ${perm('broadcasts', 'DELETE')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Campanha arquivada.',
        schema: z.object({ id: z.string() }),
      },
    },
    errors: [...permErrors('broadcasts', 'DELETE'), NOT_FOUND],
  },
  {
    method: 'get',
    path: `${ITEM}/recipients`,
    tags: [TAG],
    summary: 'Contatos da campanha',
    description: `Contatos da campanha (paginados por \`cursor\`), com a situação do envio, se responderam e como a conversa terminou. ${perm('broadcasts', 'VIEW')}`,
    params: PARAMS,
    query: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'],
          description: 'Filtra pela situação.',
        },
        search: { type: 'string', description: 'Nome ou telefone.' },
        cursor: {
          type: 'string',
          description: 'Id do último item da página anterior.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Itens por página (padrão 50).',
        },
      },
    },
    responses: {
      200: {
        description: 'Página de contatos.',
        schema: WhatsAppAiCampaignRecipientPageDTO,
      },
    },
    errors: [...permErrors('broadcasts', 'VIEW'), NOT_FOUND],
  },
  {
    method: 'post',
    path: `${ITEM}/recipients`,
    tags: [TAG],
    summary: 'Adicionar contatos à campanha',
    description: `Uma das três formas: \`contactIds\`, \`all: true\` (até 10.000) ou \`rows\` da planilha (até 5.000: telefone, nome e colunas extras usadas nas variáveis; telefones novos viram contatos). Descadastrados e telefones inválidos ficam de fora; quem já está na campanha não entra de novo. Uma campanha concluída volta a \`PAUSED\`. Devolve a campanha com \`added\`, \`rejected\` e \`optedOut\`. Auditado. ${perm('broadcasts', 'EDIT')}`,
    params: PARAMS,
    body: QueueWhatsAppAiCampaignSchema,
    responses: {
      200: {
        description: 'Contatos adicionados.',
        schema: WhatsAppAiCampaignDTO,
      },
    },
    errors: [...permErrors('broadcasts', 'EDIT'), NOT_FOUND],
  },
  {
    method: 'delete',
    path: `${ITEM}/recipients`,
    tags: [TAG],
    summary: 'Limpar contatos da campanha',
    description: `Remove os pendentes; \`?all=true\` remove todos (podem ser adicionados de novo). Só com a campanha parada. Auditado. ${perm('broadcasts', 'EDIT')}`,
    params: PARAMS,
    query: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: 'Remover todos (padrão: só pendentes).',
        },
      },
    },
    responses: {
      200: {
        description: 'Contatos removidos.',
        schema: WhatsAppAiCampaignDTO,
      },
    },
    errors: [...permErrors('broadcasts', 'EDIT'), NOT_FOUND, RUNNING],
  },
  {
    method: 'post',
    path: `${ITEM}/play`,
    tags: [TAG],
    summary: 'Iniciar campanha (play)',
    description: `Liga o envio: o worker manda o template a um contato por vez, no intervalo da campanha, dentro do horário de atendimento. Cada envio abre (ou reabre) a conversa ligada à campanha — uma conversa aberta recebe o template de novo —, com a IA respondendo pelas instruções e ações da campanha (se \`aiReplies\` e se ninguém assumiu a conversa). Contatos descadastrados ou sem valor para uma variável são pulados. Para sozinho ao esvaziar (\`DONE\`) ou no limite mensal (\`PAUSED\` com \`lastError\`). Já rodando = sem efeito. Auditado. ${perm('broadcasts', 'EDIT')}`,
    params: PARAMS,
    responses: {
      200: { description: 'Campanha ligada.', schema: WhatsAppAiCampaignDTO },
    },
    errors: [
      ...permErrors('broadcasts', 'EDIT'),
      NOT_FOUND,
      {
        code: 'WHATSAPP_AI_CAMPAIGN_NOT_READY',
        when: 'Falta conexão da Meta, template aprovado, variável preenchida ou contato (a mensagem lista o que falta)',
      },
    ],
  },
  {
    method: 'post',
    path: `${ITEM}/pause`,
    tags: [TAG],
    summary: 'Pausar campanha',
    description: `Pausa o envio; o envio em andamento termina e nenhum outro sai até o próximo play. A IA continua respondendo as conversas já abertas. Parada = sem efeito. Auditado. ${perm('broadcasts', 'EDIT')}`,
    params: PARAMS,
    responses: {
      200: { description: 'Campanha pausada.', schema: WhatsAppAiCampaignDTO },
    },
    errors: [...permErrors('broadcasts', 'EDIT'), NOT_FOUND],
  },
  {
    method: 'get',
    path: `${ITEM}/action-runs`,
    tags: [TAG],
    summary: 'Ações executadas pela IA',
    description: `As últimas 100 ações que a IA executou nas conversas da campanha, com o motivo que ela deu e o resultado. ${perm('broadcasts', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Ações executadas.',
        schema: z.array(WhatsAppAiCampaignActionRunDTO),
      },
    },
    errors: [...permErrors('broadcasts', 'VIEW'), NOT_FOUND],
  },
]
