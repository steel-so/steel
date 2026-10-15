import {
  GenerateSiteSchema,
  GenerateSiteSectionSchema,
  RewriteSitePageSchema,
  SuggestSiteImagesSchema,
} from '@/src/schemas/site-ai.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SiteAiContextDTOSchema,
  SiteAiImagesResultDTOSchema,
  SiteAiRewriteResultDTOSchema,
  SiteAiSectionResultDTOSchema,
} from '../../schemas/crm/site-ai'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/** CRM · Sites — gerador de sites com IA (S4) e as ações de IA do editor.
 * Usam o provedor e a cota mensal da IA do CRM (ADR 0007). */

const TAG = ['CRM · Sites'] as ['CRM · Sites']

const SITE_ID = {
  description: 'Id do site.',
  example: 'ckw1site0000ab7d3k1e5xyz',
}
const SITE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_NOT_FOUND',
  when: 'Site inexistente, excluído ou de outro workspace',
}
const AI_ERRORS: ErrorEntry[] = [
  {
    code: 'FEATURE_NOT_ENABLED',
    when: 'Feature `crm.aiAssistant` desligada para o workspace',
  },
  {
    code: 'AI_QUOTA_EXCEEDED',
    when: 'Cota mensal de IA do workspace esgotada',
  },
  {
    code: 'AI_PROVIDER_UNAVAILABLE',
    when: 'Nenhum modelo habilitado com provedor configurado',
  },
  {
    code: 'SITE_AI_FAILED',
    when: 'O provedor falhou ou não devolveu nada aproveitável depois das tentativas de correção',
  },
]
const DOCUMENT_INVALID: ErrorEntry = {
  code: 'SITE_DOCUMENT_INVALID',
  when: 'O documento enviado não passa na validação do catálogo `site`',
}
const COMMON =
  'Usa a IA do CRM do workspace e consome a cota mensal; a resposta do modelo é conferida e, se vier fora do formato, volta para ele corrigir (até 3 chamadas). Limite próprio: o de mensagens de IA por usuário.'

export const crmSiteAiRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/ai',
    tags: TAG,
    summary: 'Contexto do gerador de sites com IA',
    description: describe(
      'Pré-preenche o formulário "Gerar com IA": nome, logo e cor da marca do e-mail, produtos ativos do CRM, formulários publicados e quantos depoimentos as landing pages têm. Traz também a cota mensal de IA e o custo estimado de cada ação com o modelo do workspace.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    responses: {
      200: { description: 'Contexto.', schema: SiteAiContextDTOSchema },
    },
    errors: [...CRM_ERRORS],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/ai/generate',
    tags: TAG,
    summary: 'Gerar site com IA (stream)',
    description: describe(
      'Cria um site em rascunho a partir do briefing: tema (paleta e fontes a partir da marca), páginas pedidas (Início sempre) montadas com as seções prontas do catálogo e textos em pt-BR, título e descrição de SEO por página, cabeçalho e rodapé globais e o formulário do CRM na seção de contato (um escolhido, um novo "Contato pelo site" ou nenhum).',
      'Responde em **`text/event-stream`**, um frame por evento `event: <type>\\ndata: <json>\\n\\n` no formato `SiteAiEvent` (`types/site-ai.d.ts`): `steps` (lista de etapas) → `step` (`running`/`done`/`failed`)* → `done` (site criado, custo e avisos) ou `error`. Comentários `: ping` mantêm a conexão viva. Nada é gravado antes de todas as páginas ficarem prontas, e todo documento passa pela validação do catálogo.',
      'Erros detectados **antes** do stream (permissão, plano, cota, limite de sites, formulário) voltam no envelope JSON.',
      COMMON,
      crmAccess('landing-pages', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: GenerateSiteSchema,
      example: {
        name: 'Padaria Pão & Cia',
        business:
          'Padaria artesanal com fermentação natural, entrega no bairro e encomendas para festas.',
        audience: 'Famílias e pequenos cafés da região',
        goal: 'leads',
        tone: 'friendly',
        pages: ['about', 'products', 'contact'],
        style: 'auto',
        primaryColor: '#AA3300',
        productIds: ['ckw1prod0000ab7d3k1e5xyz'],
        createContactForm: true,
      },
    },
    responses: {
      200: {
        description: 'Stream de eventos da geração.',
        envelope: false,
        contentType: 'text/event-stream',
        schema: { type: 'string' },
        example:
          'event: step\ndata: {"type":"step","id":"theme","label":"Criando tema…","status":"running"}\n\n',
      },
    },
    errors: [
      ...CRM_ERRORS,
      { code: 'SITE_LIMIT_REACHED', when: 'O workspace já tem 100 sites' },
      {
        code: 'VALIDATION_ERROR',
        when: 'Briefing inválido ou o formulário escolhido não está publicado',
      },
      notFoundError('CrmForm', 'Formulário do CRM inexistente no workspace'),
      ...AI_ERRORS,
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/ai/section',
    tags: TAG,
    summary: 'Gerar seção com IA',
    description: describe(
      'Escolhe a seção pronta que atende ao pedido (no estilo do site) e escreve os textos dela. Devolve o fragmento validado; o editor insere na página.',
      COMMON,
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: {
      schema: GenerateSiteSectionSchema,
      example: {
        prompt: 'Três motivos para encomendar bolos com a gente',
        pageTitle: 'Início',
      },
    },
    responses: {
      200: {
        description: 'Seção gerada.',
        schema: SiteAiSectionResultDTOSchema,
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, ...AI_ERRORS],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/ai/rewrite',
    tags: TAG,
    summary: 'Reescrever textos da página com IA',
    description: describe(
      'Reescreve os textos da página enviada (ou só dos nós em `nodeIds`) no tom e tamanho pedidos. Dados reais (produtos, preços, depoimentos, logo) não são tocados. Devolve as mudanças por nó; o editor aplica como um passo só (Ctrl+Z desfaz).',
      COMMON,
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: {
      schema: RewriteSitePageSchema,
      example: {
        document: { catalog: 'site', version: 1, rootId: 'root', nodes: {} },
        tone: 'formal',
        length: 'shorter',
      },
    },
    responses: {
      200: {
        description: 'Mudanças nos textos.',
        schema: SiteAiRewriteResultDTOSchema,
      },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      DOCUMENT_INVALID,
      { code: 'VALIDATION_ERROR', when: 'Não há textos para reescrever' },
      ...AI_ERRORS,
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/ai/images',
    tags: TAG,
    summary: 'Sugerir imagens com IA',
    description: describe(
      'Para cada imagem da página, sugere uma da biblioteca de mídia do workspace ou das imagens de exemplo do catálogo (nunca um endereço de terceiros), com texto alternativo e a descrição da foto ideal.',
      COMMON,
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: {
      schema: SuggestSiteImagesSchema,
      example: {
        document: { catalog: 'site', version: 1, rootId: 'root', nodes: {} },
      },
    },
    responses: {
      200: { description: 'Sugestões.', schema: SiteAiImagesResultDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      DOCUMENT_INVALID,
      { code: 'VALIDATION_ERROR', when: 'A página não tem imagens' },
      ...AI_ERRORS,
    ],
  },
]
