import { z } from 'zod'
import {
  AnswerSurveySchema,
  SendSurveySchema,
  SurveyListQuerySchema,
  SurveyReportQuerySchema,
  UpdateSurveyConfigSchema,
} from '@/src/schemas/satisfaction-survey.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  PublicSurveyDTO,
  SurveyAnsweredDTO,
  SurveyConfigDTO,
  SurveyDTO,
  SurveyListDTO,
  SurveyReportDTO,
} from '../../schemas/satisfaction-survey'
import { PRIVILEGED, PRIVILEGED_ERRORS, perm, permErrors } from './shared'

const TAG = 'Comunicação · Pesquisas' as const
const BASE = '/workspaces/{id}/surveys'
const PUBLIC_BASE = '/surveys/public/{token}'

const TOKEN_PARAM = {
  token: 'Token do link enviado por e-mail (24+ caracteres, sem sessão).',
}

const PUBLIC_ERRORS: ErrorEntry[] = [
  {
    code: 'SURVEY_NOT_FOUND',
    when: 'Token desconhecido, pesquisa só de WhatsApp ou ainda não enviada',
  },
]

/**
 * Pesquisas de satisfação NPS/CSAT/CES. Disparam sozinhas ao encerrar uma
 * conversa do zap ou resolver um chamado (regras em `config`), ou à mão
 * (`POST /surveys`). A resposta chega pelo WhatsApp (botão ou número digitado,
 * tratados no webhook, sem rota própria) ou pelo link do e-mail.
 */
export const surveyRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/config`,
    tags: [TAG],
    summary: 'Regras das pesquisas',
    description: `As duas regras (\`CONVERSATION_CLOSED\` e \`TICKET_RESOLVED\`); a que nunca foi salva volta com os padrões, desligada. ${perm('conversations', 'VIEW')}`,
    responses: {
      200: {
        description: 'Regras.',
        schema: z.array(SurveyConfigDTO),
      },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'put',
    path: `${BASE}/config/{trigger}`,
    tags: [TAG],
    summary: 'Salvar a regra de um gatilho',
    description: `Atualiza só os campos enviados (tipo, ligada, atraso, validade, intervalo por cliente, e-mail como alternativa, textos). Auditado. ${PRIVILEGED}`,
    params: { trigger: '`CONVERSATION_CLOSED` ou `TICKET_RESOLVED`.' },
    body: UpdateSurveyConfigSchema,
    responses: {
      200: { description: 'Regra salva.', schema: SurveyConfigDTO },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: BASE,
    tags: [TAG],
    summary: 'Listar pesquisas enviadas',
    description: `Convites do workspace, mais novos primeiro, com nota e comentário quando respondidos. ${perm('conversations', 'VIEW')}`,
    query: SurveyListQuerySchema,
    responses: { 200: { description: 'Página.', schema: SurveyListDTO } },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'post',
    path: BASE,
    tags: [TAG],
    summary: 'Enviar uma pesquisa agora',
    description: `Envio avulso (pós-venda) para um contato do WhatsApp (conexão conectada, contato que não pediu descadastro) ou um e-mail. Sem atraso e sem intervalo por cliente. Auditado. ${perm('conversations', 'EDIT')}`,
    body: SendSurveySchema,
    responses: {
      201: { description: 'Pesquisa agendada.', schema: SurveyDTO },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      { code: 'SURVEY_NOT_FOUND', when: 'Contato do WhatsApp inexistente' },
      {
        code: 'SURVEY_NO_RECIPIENT',
        when: 'Sem conexão conectada ou contato descadastrado, e sem e-mail',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/report`,
    tags: [TAG],
    summary: 'Relatório de satisfação',
    description: `Resultado de um tipo (NPS, CSAT ou CES) agrupado por \`agent\` (conversas), \`technician\` (chamados), \`team\` ou \`customer\`: enviadas, respondidas, taxa de resposta, média e a métrica do tipo (NPS, % satisfeitos ou esforço médio). ${perm('conversations', 'VIEW')}`,
    query: SurveyReportQuerySchema,
    responses: { 200: { description: 'Relatório.', schema: SurveyReportDTO } },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'get',
    path: PUBLIC_BASE,
    tags: [TAG],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Pesquisa do link do e-mail',
    description:
      'Pergunta, escala e estado (`OPEN`, `ANSWERED`, `EXPIRED`). Só mostra; responder exige o POST, para que scanners de link não respondam sozinhos.',
    params: TOKEN_PARAM,
    responses: { 200: { description: 'Pesquisa.', schema: PublicSurveyDTO } },
    errors: PUBLIC_ERRORS,
  },
  {
    method: 'post',
    path: PUBLIC_BASE,
    tags: [TAG],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Responder a pesquisa do link do e-mail',
    description:
      'Grava a nota (na escala do tipo) e o comentário opcional, uma única vez. Uma nota CSAT de chamado também aparece no chamado.',
    params: TOKEN_PARAM,
    body: AnswerSurveySchema,
    responses: {
      200: { description: 'Resposta gravada.', schema: SurveyAnsweredDTO },
    },
    errors: [
      ...PUBLIC_ERRORS,
      { code: 'SURVEY_ALREADY_ANSWERED', when: 'Já respondida' },
      { code: 'SURVEY_EXPIRED', when: 'Prazo de resposta vencido' },
      { code: 'SURVEY_INVALID_SCORE', when: 'Nota fora da escala do tipo' },
    ],
  },
]
