import { AiKnowledgeSearchQuerySchema } from '@/src/schemas/ai-knowledge.schema'
import { WORKSPACE_MEMBER_ERRORS } from '../common'
import type { OpenApiRegistry, RouteConfig } from '../registry'
import { AiKnowledgeSearchResponseDTO } from '../schemas/ai-knowledge'

/** Busca de conhecimento do Steel AI (ADR 0037). */

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/ai/knowledge/search',
    tags: ['Steel AI'],
    summary: 'Buscar na base de conhecimento',
    description:
      'Busca híbrida (texto completo em português + similaridade semântica, combinados por reciprocal rank fusion) sobre artigos da base de conhecimento, páginas da Wiki, chamados resolvidos, documentos da IA do WhatsApp e notas e propostas do CRM. É a mesma busca da ferramenta `steel_search`. Cada fonte segue a regra do próprio módulo: módulo habilitado, permissão `VIEW`, Wiki ligada, documentos da IA do WhatsApp só para OWNER/ADMIN e, no ServiceDesk, solicitantes veem só os próprios chamados e os artigos do portal. Sem provedor de embeddings ou sem pgvector, responde só por texto (`mode: text`). `sources` (separadas por vírgula) restringe as fontes.',
    query: AiKnowledgeSearchQuerySchema,
    responses: {
      200: {
        description: 'Uma entrada por fonte, em ordem de relevância.',
        schema: AiKnowledgeSearchResponseDTO,
      },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      {
        code: 'AI_DISABLED',
        when: 'Steel AI desligado no workspace (Ajustes > Steel IA)',
      },
      'RATE_LIMITED',
    ],
  },
]

export function registerSteelAiKnowledgePaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
