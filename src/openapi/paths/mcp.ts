import type { OpenApiRegistry, RouteConfig } from '../registry'

/**
 * Servidor MCP público (`app/api/mcp`, ADR 0032). Fala JSON-RPC 2.0 no
 * transporte Streamable HTTP do Model Context Protocol, sem sessão. A
 * credencial é o access token OAuth do Steel (ADR 0033) no header
 * `Authorization: Bearer`, nunca o cookie de sessão.
 */

const JSON_RPC_BODY = {
  type: 'object',
  required: ['jsonrpc', 'method'],
  properties: {
    jsonrpc: { type: 'string', enum: ['2.0'] },
    id: { type: ['string', 'integer'] },
    method: {
      type: 'string',
      description:
        '`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`, `ping`.',
    },
    params: { type: 'object' },
  },
} as const

const METHOD_NOT_ALLOWED = {
  description:
    'Servidor sem estado: não abre stream SSE (GET) nem encerra sessão (DELETE). Responde com `Allow: POST`.',
  envelope: false,
}

const routes: RouteConfig[] = [
  {
    method: 'post',
    path: '/mcp',
    tags: ['Steel MCP'],
    summary: 'Chamada MCP (JSON-RPC)',
    description: [
      'Servidor MCP remoto do Steel para clientes de IA (Claude, ChatGPT, Cursor…). Exige `Authorization: Bearer <access token>` emitido pelo OAuth do Steel; o token define usuário, workspace, módulos e escopos — nada disso vem dos argumentos.',
      '',
      '- **Ferramentas:** as de leitura do Steel AI que o usuário pode usar nos módulos concedidos (filtro por módulo e perfil de acesso). Resultado com `structuredContent` e resumo em texto, até ~20 KB; erros de domínio voltam com `isError: true`.',
      '- **Resources:** artigos publicados da base de conhecimento (`steel://servicedesk/kb/{id}`) e páginas da Wiki (`steel://wiki/pages/{id}`), em Markdown, paginados por cursor.',
      '- **Prompts:** prontos por módulo, em português.',
      '',
      'Sem token, ou com token inválido, revogado ou de quem saiu do workspace: `401` com `WWW-Authenticate: Bearer resource_metadata="<app>/.well-known/oauth-protected-resource"`. Rate limit por usuário (`mcp:<userId>`, 120/min) e por cliente OAuth (`mcp-client:<clientId>`, 600/min).',
    ].join('\n'),
    auth: 'public',
    rateLimit: false,
    headers: {
      Authorization: {
        description: '`Bearer <access token>` do OAuth do Steel.',
        required: true,
      },
      Accept: {
        description: 'Deve aceitar `application/json` e `text/event-stream`.',
        required: true,
      },
    },
    body: {
      schema: JSON_RPC_BODY,
      description: 'Mensagem (ou lote) JSON-RPC 2.0.',
      example: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    },
    responses: {
      200: {
        description: 'Resposta JSON-RPC 2.0 (`result` ou `error`).',
        envelope: false,
      },
      202: {
        description: 'Notificação ou resposta recebida (sem corpo).',
        envelope: false,
      },
    },
    errors: [
      {
        code: 'UNAUTHORIZED',
        message: 'Token de integração inválido ou ausente',
        when: 'Token ausente, inválido, expirado ou revogado; concessão revogada; usuário fora do workspace',
      },
      'RATE_LIMITED',
    ],
  },
  {
    method: 'get',
    path: '/mcp',
    tags: ['Steel MCP'],
    summary: 'Stream SSE (não suportado)',
    auth: 'public',
    rateLimit: false,
    responses: { 405: METHOD_NOT_ALLOWED },
    autoErrors: false,
  },
  {
    method: 'delete',
    path: '/mcp',
    tags: ['Steel MCP'],
    summary: 'Encerrar sessão (não suportado)',
    auth: 'public',
    rateLimit: false,
    responses: { 405: METHOD_NOT_ALLOWED },
    autoErrors: false,
  },
]

export function registerMcpPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
