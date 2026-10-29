import type { IntegrationGrantDTO } from '@/types/integration-grant'

/**
 * Guided "connect with one click" data (C10): per AI app, where to go, what
 * to paste and which redirect hosts identify an existing connection. Pure, so
 * the panel and its tests share one source. Menu names change often; the
 * steps stay generic and the doc page keeps the detail.
 */

export type McpConnectClientId = 'claude' | 'chatgpt' | 'gemini'

export interface McpConnectGuide {
  id: McpConnectClientId
  name: string
  /** Where the user adds the connector (opens in a new tab). */
  openUrl: string | null
  openLabel: string
  steps: string[]
  /** Terminal command with the server URL, when the app has one. */
  command: ((mcpUrl: string) => string) | null
  commandLabel: string | null
  /**
   * Redirect hosts that identify this app in "Apps conectados". Empty when
   * the app connects through a loopback port (the grant can't be told apart).
   */
  redirectHosts: string[]
  note: string | null
}

export const MCP_CONNECT_GUIDES: McpConnectGuide[] = [
  {
    id: 'claude',
    name: 'Claude',
    openUrl: 'https://claude.ai/settings/connectors',
    openLabel: 'Abrir os conectores do Claude',
    steps: [
      'Copie o endereço do Steel acima.',
      'Abra os conectores do Claude e clique em “Adicionar conector personalizado”.',
      'Dê o nome Steel, cole o endereço e confirme.',
      'Clique em “Conectar”, entre no Steel e escolha o workspace, os módulos e o nível de acesso.',
    ],
    command: (url) => `claude mcp add --transport http steel ${url}`,
    commandLabel: 'Claude Code (terminal)',
    redirectHosts: ['claude.ai', 'claude.com'],
    note: 'Nos planos Team e Enterprise, só o dono da organização no Claude adiciona o conector; depois cada pessoa clica em Conectar.',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    openUrl: 'https://chatgpt.com/#settings/Connectors',
    openLabel: 'Abrir os conectores do ChatGPT',
    steps: [
      'Copie o endereço do Steel acima.',
      'Abra os conectores do ChatGPT, ligue o modo desenvolvedor em Configurações avançadas e clique em “Criar”.',
      'Dê o nome Steel, cole o endereço em URL do servidor MCP e escolha a autenticação OAuth.',
      'Entre no Steel e escolha o workspace, os módulos e o nível de acesso.',
    ],
    command: null,
    commandLabel: null,
    redirectHosts: ['chatgpt.com', 'openai.com'],
    note: 'No ChatGPT Business e Enterprise, um administrador pode precisar liberar o modo desenvolvedor.',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    openUrl: null,
    openLabel: '',
    steps: [
      'Copie o comando abaixo e rode no terminal onde o Gemini CLI está instalado.',
      'Abra o Gemini CLI e digite /mcp auth steel para autorizar.',
      'Entre no Steel e escolha o workspace, os módulos e o nível de acesso.',
    ],
    command: (url) => `gemini mcp add --transport http steel ${url}`,
    commandLabel: 'Gemini CLI (terminal)',
    redirectHosts: [],
    note: 'O app Gemini na web ainda não aceita conectores próprios; o Gemini CLI e o modo agente do Gemini Code Assist aceitam. A conexão pelo terminal aparece em Apps conectados como um app no seu computador.',
  },
]

/** The workspace's MCP endpoint (`<app origin>/api/mcp`, no trailing slash). */
export function mcpServerUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/mcp`
}

/**
 * Is the signed-in user already connected through this app to this
 * workspace? Judged by the redirect host the user approved, never by the
 * self-declared client name.
 */
export function isGuideConnected(
  guide: McpConnectGuide,
  grants: Pick<IntegrationGrantDTO, 'redirectHost' | 'workspace'>[],
  workspaceId: string,
): boolean {
  if (guide.redirectHosts.length === 0) return false
  return grants.some(
    (grant) =>
      grant.workspace.id === workspaceId &&
      grant.redirectHost !== null &&
      guide.redirectHosts.includes(grant.redirectHost.toLowerCase()),
  )
}
