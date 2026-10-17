import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import type { AiToolAccess } from '@/src/lib/ai/tools/registry'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import type { McpGrant } from './grant'
import { getMcpPrompt, listMcpPrompts } from './prompts'
import {
  listMcpResources,
  MCP_RESOURCE_TEMPLATES,
  readMcpResource,
} from './resources'
import { callMcpTool, mcpTools, toMcpTool } from './tools'

/**
 * Steel MCP server (ADR 0032): a thin adapter over the Steel AI tool
 * registry, built per HTTP request (stateless Streamable HTTP). Identity,
 * workspace, modules and scopes come from the grant the bearer token
 * resolved to — never from tool arguments.
 */

export const MCP_SERVER_NAME = 'steel'
export const MCP_SERVER_VERSION = '1.0.0'

const INSTRUCTIONS = [
  'Servidor MCP do Steel (ServiceDesk, CRM e Comunicação/WhatsApp).',
  'Cada chamada roda com as permissões do usuário que autorizou o acesso, no workspace escolhido no consentimento.',
  'As ferramentas devolvem um resumo em texto e os dados em JSON; quando o resultado vier truncado, refine os filtros ou use um `limit` menor.',
  'Ferramentas de escrita só aparecem quando o acesso foi autorizado com escrita e um administrador ligou "Permitir escrita via MCP"; exclusões nunca são oferecidas.',
  'Ações que chegam a um cliente final (mensagem de WhatsApp, resposta ao solicitante, link de aprovação) não são executadas na hora: devolvem `confirmUrl` para a pessoa confirmar no Steel.',
  'Envie `idempotencyKey` nas escritas para repetir com segurança uma chamada que não teve resposta.',
  'Artigos da base de conhecimento e páginas da Wiki estão disponíveis como resources.',
].join(' ')

export interface McpServerDeps {
  tools?: readonly AnySteelAiTool[]
  /** Public origin for absolute links (default `BETTER_AUTH_URL`). */
  origin?: string
}

export function createSteelMcpServer(
  grant: McpGrant,
  access: AiToolAccess,
  deps: McpServerDeps = {},
): Server {
  const registry = deps.tools ?? STEEL_AI_TOOLS
  const origin = deps.origin ?? BETTER_AUTH_URL
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Steel' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: INSTRUCTIONS,
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools(registry, grant, access).map(toMcpTool),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // A tool the grant can't see answers exactly like one that doesn't exist.
    const tool = mcpTools(registry, grant, access).find(
      (t) => t.name === request.params.name,
    )
    if (!tool) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Ferramenta desconhecida: ${request.params.name}`,
      )
    }
    return callMcpTool(tool, grant, request.params.arguments, { origin })
  })

  server.setRequestHandler(ListResourcesRequestSchema, (request) =>
    listMcpResources(grant, access, request.params?.cursor),
  )

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: MCP_RESOURCE_TEMPLATES,
  }))

  server.setRequestHandler(ReadResourceRequestSchema, (request) =>
    readMcpResource(grant, access, request.params.uri),
  )

  server.setRequestHandler(ListPromptsRequestSchema, async () =>
    listMcpPrompts(grant, access),
  )

  server.setRequestHandler(GetPromptRequestSchema, async (request) =>
    getMcpPrompt(grant, access, request.params.name),
  )

  return server
}

/**
 * Handles one MCP POST: a fresh server + transport per request (stateless,
 * JSON responses — nothing is kept between calls).
 */
export async function handleMcpRequest(
  request: Request,
  grant: McpGrant,
  access: AiToolAccess,
  deps: McpServerDeps = {},
): Promise<Response> {
  const server = createSteelMcpServer(grant, access, deps)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}
