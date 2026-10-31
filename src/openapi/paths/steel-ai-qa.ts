import {
  CreateQaReviewSchema,
  QaCoachingQuerySchema,
  QaReviewListQuerySchema,
  UpdateQaConfigSchema,
} from '@/src/schemas/qa-review.schema'
import { WORKSPACE_MEMBER_ERRORS, WORKSPACE_PRIVILEGED_ERRORS } from '../common'
import type { OpenApiRegistry, RouteConfig } from '../registry'
import {
  QaConfigDTO,
  QaCoachingDTO,
  QaReviewDTO,
  QaReviewListDTO,
} from '../schemas/steel-ai-qa'

/**
 * QA automático por IA (T2): nota por critérios configuráveis em toda
 * conversa do zap e todo chamado, humano ou bot, e painel de coaching por
 * atendente. A avaliação roda no worker ao encerrar a conversa ou resolver o
 * chamado, e conta na cota mensal de IA do workspace.
 */

const TAG = 'Steel AI' as const
const BASE = '/workspaces/{id}/qa'
const SCOPE =
  'Gestores (OWNER/ADMIN) enxergam todos os atendentes; os demais membros só as próprias notas.'
const MODULES = 'Exige Comunicação ou ServiceDesk habilitado no workspace.'

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/config`,
    tags: [TAG],
    summary: 'Configuração do QA automático',
    description: `Liga/desliga, limites e critérios. Sem configuração salva, volta desligado com os quatro critérios padrão (tom, resolução, conformidade e empatia). ${MODULES}`,
    responses: { 200: { description: 'Configuração.', schema: QaConfigDTO } },
    errors: [...WORKSPACE_MEMBER_ERRORS, 'MODULE_DISABLED'],
  },
  {
    method: 'put',
    path: `${BASE}/config`,
    tags: [TAG],
    summary: 'Salvar a configuração do QA',
    description: `Atualiza só os campos enviados. Enviar \`criteria\` substitui o conjunto inteiro (chaves ausentes são removidas; ao menos um ativo). Auditado. Somente OWNER/ADMIN. ${MODULES}`,
    body: UpdateQaConfigSchema,
    responses: {
      200: { description: 'Configuração salva.', schema: QaConfigDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      'MODULE_DISABLED',
      'VALIDATION_ERROR',
    ],
  },
  {
    method: 'get',
    path: `${BASE}/reviews`,
    tags: [TAG],
    summary: 'Listar avaliações',
    description: `Avaliações do workspace, mais novas primeiro, com filtros por tipo, situação, atendente (humano/bot) e nota baixa. ${SCOPE}`,
    query: QaReviewListQuerySchema,
    responses: { 200: { description: 'Página.', schema: QaReviewListDTO } },
    errors: [...WORKSPACE_MEMBER_ERRORS, 'MODULE_DISABLED', 'VALIDATION_ERROR'],
  },
  {
    method: 'post',
    path: `${BASE}/reviews`,
    tags: [TAG],
    summary: 'Avaliar (ou reavaliar) um atendimento',
    description:
      'Enfileira a avaliação de uma conversa ou de um chamado, mesmo já avaliado. Resposta imediata com a avaliação `PENDING`; o resultado chega pelo worker. Exige o QA ligado. Auditado. Somente OWNER/ADMIN.',
    body: CreateQaReviewSchema,
    responses: {
      202: { description: 'Avaliação enfileirada.', schema: QaReviewDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      'MODULE_DISABLED',
      'VALIDATION_ERROR',
      { code: 'QA_DISABLED', when: 'O QA automático está desligado' },
      {
        code: 'QA_SUBJECT_NOT_FOUND',
        when: 'Conversa ou chamado inexistente ou de outro workspace',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/reviews/{reviewId}`,
    tags: [TAG],
    summary: 'Detalhe de uma avaliação',
    description: `Nota por critério com a evidência, resumo e dicas de coaching. ${SCOPE}`,
    params: { reviewId: 'ID da avaliação.' },
    responses: { 200: { description: 'Avaliação.', schema: QaReviewDTO } },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      'MODULE_DISABLED',
      {
        code: 'QA_REVIEW_NOT_FOUND',
        when: 'Inexistente ou de outro workspace',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/coaching`,
    tags: [TAG],
    summary: 'Painel de coaching',
    description: `Avaliações concluídas do período (padrão: 30 dias) agrupadas por atendente, do menor para o maior desempenho: média, evolução por semana (UTC), critério mais fraco, dicas mais repetidas e as piores avaliações. Atendimentos só do bot formam uma linha própria. ${SCOPE}`,
    query: QaCoachingQuerySchema,
    responses: { 200: { description: 'Painel.', schema: QaCoachingDTO } },
    errors: [...WORKSPACE_MEMBER_ERRORS, 'MODULE_DISABLED', 'VALIDATION_ERROR'],
  },
]

export function registerSteelAiQaPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
