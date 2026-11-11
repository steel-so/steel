import { z } from 'zod'
import { UpdateWhatsAppSpendCapSchema } from '@/src/schemas/whatsapp-spend-cap.schema'
import type { RouteConfig } from '../../registry'
import { WhatsAppSpendCapStatusDTO } from '../../schemas/whatsapp-spend-cap'
import { PRIVILEGED, PRIVILEGED_ERRORS } from './shared'

const TAG = 'Comunicação · Configurações' as const

/** Monthly spending cap per WhatsApp number (ADR 0064). */
export const spendCapRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/costs/spend-caps',
    tags: [TAG],
    summary: 'Gasto real e limite por número',
    description: `Para cada número da API oficial da Meta: gasto do mês **lido da Meta** (\`pricing_analytics\`; custo da Meta quando a Meta libera a métrica, senão volume da Meta x tabela de preços) nos dias UTC já fechados, mais a razão do Steel desde então; limite mensal, modo, situação (liberado/bloqueado) e projeção. Cada acesso consulta a Meta (cache de 60 s por número); se a Meta falhar, volta a última leitura com \`stale: true\`. ${PRIVILEGED}`,
    query: z.object({
      connectionId: z
        .string()
        .optional()
        .meta({ description: 'Só este número.' }),
    }),
    responses: {
      200: {
        description: 'Gasto e limite por número.',
        schema: z.array(WhatsAppSpendCapStatusDTO),
      },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'put',
    path: '/workspaces/{id}/whatsapp/costs/spend-caps/{connectionId}',
    tags: [TAG],
    summary: 'Definir o limite de gasto de um número',
    description: `Limite mensal em R$ e modo: \`WARN\` só avisa OWNER/ADMIN a 80% e 100%; \`BLOCK\` também recusa envios pagos (templates) que passariam do limite com \`WHATSAPP_SPEND_CAP_REACHED\` — respostas dentro da janela de 24 h nunca são bloqueadas. \`monthlyCapAmount: null\` remove o limite. Vale só para números da Meta. Auditado. ${PRIVILEGED}`,
    params: { connectionId: 'Id da conexão (número da Meta).' },
    body: UpdateWhatsAppSpendCapSchema,
    responses: {
      200: {
        description: 'Limite salvo.',
        schema: WhatsAppSpendCapStatusDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      { code: 'RESOURCE_NOT_FOUND', when: 'Conexão não encontrada' },
      { code: 'VALIDATION_ERROR', when: 'Valor inválido ou número da Z-API' },
    ],
  },
]
