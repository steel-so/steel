import { z } from 'zod'
import {
  UpdateWhatsAppWidgetSettingsSchema,
  WidgetKeyQuerySchema,
  WidgetMessagesQuerySchema,
  WidgetSendMessageSchema,
  WidgetSurveyAnswerSchema,
} from '@/src/schemas/whatsapp-widget.schema'
import type { RouteConfig } from '../../registry'
import {
  WhatsAppWidgetSettingsDTO,
  WidgetMessagesDTO,
  WidgetPublicConfigDTO,
  WidgetSendResultDTO,
} from '../../schemas/whatsapp'
import { PRIVILEGED, PRIVILEGED_ERRORS } from './shared'

const TAG = 'Comunicação · Chat do site' as const

const PUBLIC_NOTE =
  'Rota pública, sem sessão: a credencial é a chave pública (`?key=`) mais o cabeçalho `Origin` do navegador, que precisa estar na lista de sites autorizados. O CORS devolve só a origem autorizada. Limite por IP.'

const TOKEN_HEADER = {
  'X-Steel-Widget-Token': {
    description:
      'Token do visitante (devolvido na primeira mensagem). Guardado pelo script no cookie do site.',
    required: false,
  },
}

const PUBLIC_ERRORS = [
  {
    code: 'WIDGET_NOT_AVAILABLE',
    when: 'Chave desconhecida, chat desligado ou sem conexão',
  },
  {
    code: 'WIDGET_ORIGIN_NOT_ALLOWED',
    when: 'O site (cabeçalho `Origin`) não está na lista de autorizados',
  },
] satisfies RouteConfig['errors']

export const widgetRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/widget',
    tags: [TAG],
    summary: 'Configuração do chat do site',
    description: `Liga/desliga, sites autorizados, aparência, dados antes de começar, aviso fora do horário, equipe, portal e pesquisa. Workspace que nunca salvou recebe o padrão (desligado, sem chave). ${PRIVILEGED}`,
    responses: {
      200: { description: 'Configuração.', schema: WhatsAppWidgetSettingsDTO },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/widget',
    tags: [TAG],
    summary: 'Atualizar o chat do site',
    description: `Upsert parcial (omitido = mantém). Na primeira gravação nasce a chave pública e, ao ligar, a conexão virtual \`WIDGET\` onde as conversas caem no inbox. Para ligar é preciso ao menos um site autorizado. Auditado. ${PRIVILEGED}`,
    body: UpdateWhatsAppWidgetSettingsSchema,
    responses: {
      200: { description: 'Configuração salva.', schema: WhatsAppWidgetSettingsDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        when: 'Ligar sem site autorizado ou equipe de outro workspace',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/widget/rotate-key',
    tags: [TAG],
    summary: 'Gerar nova chave do chat do site',
    description: `Troca a chave pública: os trechos de código já colados nos sites param de abrir o chat até serem atualizados. Auditado. ${PRIVILEGED}`,
    responses: {
      200: { description: 'Configuração com a nova chave.', schema: WhatsAppWidgetSettingsDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      { code: 'VALIDATION_ERROR', when: 'A configuração ainda não foi salva' },
    ],
  },
  {
    method: 'get',
    path: '/widget/config',
    tags: [TAG],
    summary: 'Aparência e estado do chat (público)',
    description: `Lido pelo script do site ao carregar: título, cor, posição, dados pedidos antes de começar e se está dentro do horário de atendimento. ${PUBLIC_NOTE}`,
    auth: 'public',
    rateLimit: 'ip',
    query: WidgetKeyQuerySchema,
    responses: {
      200: { description: 'Configuração pública.', schema: WidgetPublicConfigDTO },
    },
    errors: PUBLIC_ERRORS,
  },
  {
    method: 'get',
    path: '/widget/messages',
    tags: [TAG],
    summary: 'Mensagens do visitante (público)',
    description: `Consultado a cada poucos segundos com o chat aberto. Sem token ou com token desconhecido devolve a lista vazia. \`after\` é o cursor (ISO 8601): só mensagens criadas depois. Com a pesquisa de satisfação ligada, devolve a pesquisa aberta quando a conversa está fechada. ${PUBLIC_NOTE}`,
    auth: 'public',
    rateLimit: 'ip',
    query: WidgetMessagesQuerySchema,
    headers: TOKEN_HEADER,
    responses: {
      200: { description: 'Mensagens.', schema: WidgetMessagesDTO },
    },
    errors: PUBLIC_ERRORS,
  },
  {
    method: 'post',
    path: '/widget/messages',
    tags: [TAG],
    summary: 'Enviar mensagem do visitante (público)',
    description: `A primeira mensagem cria o visitante e o contato no zap e devolve o \`token\`; as seguintes entram na conversa pelo mesmo caminho do WhatsApp (fila, equipe, SLA, chatbot, IA). Com "dados antes de começar" ligado, nome (e e-mail/telefone, se pedidos) são obrigatórios na primeira. Fora do horário, o visitante recebe o aviso configurado (uma vez a cada 12 h). Limites: por IP, novos visitantes por IP (10 a cada 10 min) e 20 mensagens por minuto por visitante. O campo isca \`website\` precisa ficar vazio. ${PUBLIC_NOTE}`,
    auth: 'public',
    rateLimit: 'ip',
    query: WidgetKeyQuerySchema,
    headers: TOKEN_HEADER,
    body: {
      schema: WidgetSendMessageSchema,
      example: { text: 'Olá, preciso de ajuda com a minha fatura.' },
    },
    responses: {
      200: { description: 'Mensagem recebida.', schema: WidgetSendResultDTO },
    },
    errors: [
      ...PUBLIC_ERRORS,
      {
        code: 'RATE_LIMITED',
        when: 'Limite por IP ou por visitante excedido',
      },
    ],
  },
  {
    method: 'post',
    path: '/widget/survey',
    tags: [TAG],
    summary: 'Responder a pesquisa de satisfação (público)',
    description: `O visitante dá a nota da pesquisa aberta (NPS 0–10, CSAT 1–5 ou CES 1–7, conforme a regra ligada) e um comentário opcional. Exige "pedir a avaliação" ligado. ${PUBLIC_NOTE}`,
    auth: 'public',
    rateLimit: 'ip',
    query: WidgetKeyQuerySchema,
    headers: TOKEN_HEADER,
    body: WidgetSurveyAnswerSchema,
    responses: {
      200: {
        description: 'Resposta registrada.',
        schema: z.object({ answered: z.literal(true) }),
      },
    },
    errors: [
      ...PUBLIC_ERRORS,
      { code: 'WIDGET_VISITOR_INVALID', when: 'Token ausente ou desconhecido' },
      {
        code: 'VALIDATION_ERROR',
        when: 'Não há pesquisa aberta ou a nota está fora da escala',
      },
    ],
  },
]
