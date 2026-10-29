import { SdAiComparisonQuerySchema } from '@/src/schemas/sd-ai-comparison.schema'
import type { RouteConfig } from '../../registry'
import { SdAiComparisonDTO } from '../../schemas/servicedesk/ai-comparison'

/**
 * ServiceDesk · IA vs. técnico —
 * `app/api/workspaces/[id]/servicedesk/ai/comparison`.
 */

const TAG = 'ServiceDesk · IA vs. técnico' as const

export const sdAiComparisonRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/servicedesk/ai/comparison',
    tags: [TAG],
    summary: 'Painel IA vs. técnico',
    description:
      'Compara o que a IA sugeriu com o que o técnico fez no período (7, 30 ou 90 dias; padrão 30). **Triagem automática**: cada campo sugerido (categoria, subcategoria, serviço, impacto, urgência, prioridade, departamento e tags) é conferido com o valor final do chamado, só dos chamados já resolvidos ou fechados; a prioridade fica de fora quando a IA preencheu impacto ou urgência, pois a matriz a recalcula. **Copiloto**: respostas e soluções sugeridas são comparadas por similaridade de texto com o que o agente escreveu (adotada ≥ 80%, editada ≥ 35%, senão não usada; sem texto do agente a sugestão fica pendente por 24 h) e as classificações pedidas entram na precisão dos campos. Traz ainda a calibração da confiança, o desempenho por agente, o desfecho do pré-atendimento, as últimas divergências e o consumo da cota de IA do ServiceDesk. Só leitura: nada chama a IA. Acesso: sessão + **agente** do ServiceDesk com permissão de leitura de relatórios (`sd-reports`) e o módulo habilitado.',
    query: SdAiComparisonQuerySchema,
    responses: {
      200: {
        description: 'Comparativo do período.',
        schema: SdAiComparisonDTO,
      },
    },
    errors: [
      {
        code: 'FORBIDDEN',
        when: 'Não é membro do workspace ou o perfil não concede a permissão',
      },
      'WORKSPACE_SUSPENDED',
      { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
      { code: 'SD_NOT_AGENT', when: 'Solicitante (membro sem departamento)' },
      { code: 'VALIDATION_ERROR', when: 'Período fora de 7, 30 ou 90 dias' },
    ],
  },
]
