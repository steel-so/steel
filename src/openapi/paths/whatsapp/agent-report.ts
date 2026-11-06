import { WhatsAppAgentReportQuerySchema } from '@/src/schemas/whatsapp-agent-report.schema'
import type { RouteConfig } from '../../registry'
import { WhatsAppAgentReportDTO } from '../../schemas/whatsapp-agent-report'
import { perm, permErrors } from './shared'

const REPORTS_TAG = 'Comunicação · Dashboards e relatórios' as const

/** Relatório de desempenho dos atendentes (ADR 0062). */
export const agentReportRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/reports/agents',
    tags: [REPORTS_TAG],
    summary: 'Relatório de desempenho dos atendentes',
    description: `Tabulação por atendente nas conversas encerradas no período (\`closedAt\`), pelo atendente responsável no encerramento: encerradas, sucesso, insucesso, taxa de sucesso (sobre as tabuladas), encerradas sem tabulação, tempo médio de atendimento (criação até o encerramento), conversas em aberto agora e contagem por status de fechamento. \`from\`/\`to\` são datas \`YYYY-MM-DD\` em America/Sao_Paulo, inclusivas (padrão: últimos 7 dias; máximo 1 ano). \`format=csv\` baixa a planilha (\`;\`, UTF-8 com BOM; fora do envelope JSON). OWNER/ADMIN veem todos os atendentes, líderes de equipe os das equipes que lideram e os demais só a si mesmos. Recurso opt-in: só existe nos workspaces em que o admin da plataforma o ligou. ${perm('conversations', 'VIEW')}`,
    query: WhatsAppAgentReportQuerySchema,
    responses: {
      200: {
        description: 'Relatório.',
        schema: WhatsAppAgentReportDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      {
        code: 'WHATSAPP_AGENT_REPORT_DISABLED',
        when: 'O relatório não foi ligado para o workspace',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'Período invertido ou maior que 1 ano',
      },
    ],
  },
]
