import {
  ListAiInsightsQuerySchema,
  UpdateAiDigestSettingsSchema,
  UpdateAiInsightSchema,
} from '@/src/schemas/ai-insight.schema'
import { WORKSPACE_MEMBER_ERRORS } from '../common'
import type { OpenApiRegistry, RouteConfig } from '../registry'
import {
  AiDigestSettingsDTO,
  AiInsightDTO,
  AiInsightFeedDTO,
} from '../schemas/ai-insight'

/** IA proativa: alertas e resumo diário (ADR 0040). */

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/ai/insights',
    tags: ['Steel AI'],
    summary: 'Listar alertas da IA proativa',
    description:
      'Alertas da própria pessoa, calculados a cada 15 minutos por regra (sem LLM): previsão de estouro de SLA (responsável, líderes do departamento e admins do ServiceDesk), oportunidades sem contato, etapa travada e previsão abaixo da meta (dono do negócio; OWNER/ADMIN veem o total), conversas aguardando atendente e sentimento em queda (regra de Equipes). Cada leitura confere de novo o módulo habilitado e a permissão `VIEW` do módulo. `state`: `active` (padrão), `snoozed` ou `dismissed`. Mais grave e mais recente primeiro.',
    query: ListAiInsightsQuerySchema,
    responses: {
      200: { description: 'Alertas e contagens.', schema: AiInsightFeedDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, 'RATE_LIMITED'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/ai/insights/{insightId}',
    tags: ['Steel AI'],
    summary: 'Dispensar, adiar ou restaurar um alerta',
    description:
      '`dismiss` esconde o alerta enquanto a condição durar (se ela voltar depois, é um alerta novo); `snooze` esconde por `hours` (1 a 168); `restore` desfaz os dois. Só a própria pessoa age sobre os seus alertas.',
    params: { insightId: 'Id do alerta.' },
    body: UpdateAiInsightSchema,
    responses: {
      200: { description: 'Alerta atualizado.', schema: AiInsightDTO },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      {
        code: 'AI_INSIGHT_NOT_FOUND',
        when: 'Alerta inexistente, de outra pessoa ou de um módulo sem acesso',
      },
      'RATE_LIMITED',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/digest-settings',
    tags: ['Steel AI'],
    summary: 'Canais do resumo diário da IA',
    description:
      'Resumo diário dos alertas ativos, a partir das 08:00 no fuso da pessoa, só nos dias com alerta. Ligado por padrão na caixa de entrada e por e-mail.',
    responses: {
      200: { description: 'Canais.', schema: AiDigestSettingsDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, 'RATE_LIMITED'],
  },
  {
    method: 'put',
    path: '/workspaces/{id}/ai/digest-settings',
    tags: ['Steel AI'],
    summary: 'Ligar ou desligar o resumo diário da IA',
    description: 'Informe ao menos um canal (`inApp`, `email`).',
    body: UpdateAiDigestSettingsSchema,
    responses: {
      200: { description: 'Canais salvos.', schema: AiDigestSettingsDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, 'RATE_LIMITED'],
  },
]

export function registerSteelAiInsightsPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
