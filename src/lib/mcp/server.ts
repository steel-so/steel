import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import type { AiToolAccess } from '@/src/lib/ai/tools/registry'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import {
  MCP_CALL_TOOL_NAME,
  MCP_FIND_TOOLS_NAME,
  MCP_TOOLS_LIST_THRESHOLD,
  type McpToolListing,
  mcpMetaToolDefinitions,
  planMcpToolListing,
  resolveCallToolTarget,
  runMcpFindTools,
} from './discovery'
import type { McpGrant } from './grant'
import { getMcpPrompt, listMcpPrompts } from './prompts'
import {
  listMcpResources,
  MCP_RESOURCE_TEMPLATES,
  readMcpResource,
} from './resources'
import {
  logMcpToolCall,
  logMcpToolsList,
  withMcpErrorReport,
} from './telemetry'
import { readMcpToolUsage } from './tool-usage'
import { callMcpTool, mcpToolError, mcpTools, toMcpTool } from './tools'

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
  'Artigos da base de conhecimento e páginas da Wiki estão disponíveis como resources.',
  'Se nenhuma ferramenta listada servir, use steel_find_tools (quando listada) para encontrar as demais.',
].join(' ')

export interface McpServerDeps {
  tools?: readonly AnySteelAiTool[]
}

export function createSteelMcpServer(
  grant: McpGrant,
  access: AiToolAccess,
  deps: McpServerDeps = {},
): Server {
  const registry = deps.tools ?? STEEL_AI_TOOLS
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Steel' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: INSTRUCTIONS,
    },
  )

  const exposed = () => mcpTools(registry, grant, access)
  // Listed vs hidden only matters above the threshold; the usage read
  // (Redis) happens only then.
  const listing = async (tools: AnySteelAiTool[]): Promise<McpToolListing> =>
    planMcpToolListing(
      tools,
      tools.length > MCP_TOOLS_LIST_THRESHOLD
        ? await readMcpToolUsage(grant.workspaceId)
        : {},
    )
  const guard = <T>(method: string, request: unknown, run: () => Promise<T>) =>
    withMcpErrorReport(grant, method, request, run)

  server.setRequestHandler(ListToolsRequestSchema, (request) =>
    guard('tools/list', request, async () => {
      const plan = await listing(exposed())
      logMcpToolsList(grant, {
        listed: plan.listed.length,
        hidden: plan.hidden.length,
      })
      return {
        tools: [...plan.listed.map(toMcpTool), ...mcpMetaToolDefinitions(plan)],
      }
    }),
  )

  server.setRequestHandler(CallToolRequestSchema, (request) =>
    guard('tools/call', request, async () => {
      const tools = exposed()
      const { name, arguments: args } = request.params
      if (name === MCP_FIND_TOOLS_NAME || name === MCP_CALL_TOOL_NAME) {
        const plan = await listing(tools)
        // Meta-tools exist only while something is hidden.
        if (plan.hidden.length > 0) {
          return name === MCP_FIND_TOOLS_NAME
            ? findToolsResult(grant, tools, plan, args)
            : callHiddenTool(grant, tools, args)
        }
      }
      // A hidden tool (compact list) still runs by its own name; one the
      // grant can't see answers exactly like one that doesn't exist.
      const tool = tools.find((t) => t.name === name)
      if (!tool) throw unknownTool(name)
      return callMcpTool(tool, grant, args)
    }),
  )

  server.setRequestHandler(ListResourcesRequestSchema, (request) =>
    guard('resources/list', request, () =>
      listMcpResources(grant, access, request.params?.cursor),
    ),
  )

  server.setRequestHandler(ListResourceTemplatesRequestSchema, (request) =>
    guard('resources/templates/list', request, async () => ({
      resourceTemplates: MCP_RESOURCE_TEMPLATES,
    })),
  )

  server.setRequestHandler(ReadResourceRequestSchema, (request) =>
    guard('resources/read', request, () =>
      readMcpResource(grant, access, request.params.uri),
    ),
  )

  server.setRequestHandler(ListPromptsRequestSchema, (request) =>
    guard('prompts/list', request, async () => listMcpPrompts(grant, access)),
  )

  server.setRequestHandler(GetPromptRequestSchema, (request) =>
    guard('prompts/get', request, async () =>
      getMcpPrompt(grant, access, request.params.name),
    ),
  )

  return server
}

function unknownTool(name: string): McpError {
  return new McpError(
    ErrorCode.InvalidParams,
    `Ferramenta desconhecida: ${name}`,
  )
}

function findToolsResult(
  grant: McpGrant,
  tools: AnySteelAiTool[],
  plan: McpToolListing,
  args: unknown,
): CallToolResult {
  const startedAt = Date.now()
  const result = runMcpFindTools(tools, plan, args)
  logMcpToolCall(grant, {
    tool: { name: MCP_FIND_TOOLS_NAME, kind: 'READ', module: null },
    outcome: 'ok',
    durationMs: Date.now() - startedAt,
  })
  return {
    content: [
      { type: 'text', text: result.summary },
      { type: 'text', text: JSON.stringify(result) },
    ],
    structuredContent: { ...result },
  }
}

/** `steel_call_tool`: runs an exposed READ tool by name. */
async function callHiddenTool(
  grant: McpGrant,
  tools: AnySteelAiTool[],
  args: unknown,
): Promise<CallToolResult> {
  const target = resolveCallToolTarget(tools, args)
  if (target.ok) {
    return callMcpTool(target.tool, grant, target.arguments, {
      via: MCP_CALL_TOOL_NAME,
    })
  }
  if (target.reason === 'missing_name') {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Informe o nome da ferramenta em "name".',
    )
  }
  if (target.reason === 'unknown') throw unknownTool(target.name)
  return mcpToolError({
    code: 'AI_TOOL_NOT_ALLOWED',
    message: `${target.name} é uma ferramenta de escrita: chame-a diretamente pelo nome, ela já está na lista.`,
  })
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
