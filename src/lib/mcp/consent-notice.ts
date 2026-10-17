/**
 * LGPD notice of the MCP consent screen (owner decision, 2026-10-17). The
 * copy is fixed; bump the version whenever it changes, since the audit
 * event of every consent records which notice the user saw.
 */

export const MCP_CONSENT_NOTICE_VERSION = 'mcp-consent-v1'

export const MCP_MODULE_LABELS = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação',
} as const

export type McpModuleKey = keyof typeof MCP_MODULE_LABELS

/** "ServiceDesk, CRM e Comunicação". */
export function formatModuleList(modules: readonly McpModuleKey[]): string {
  return new Intl.ListFormat('pt-BR', {
    style: 'long',
    type: 'conjunction',
  }).format(modules.map((module) => MCP_MODULE_LABELS[module]))
}

export function mcpConsentNotice(input: {
  clientName: string
  workspaceName: string
  modules: readonly McpModuleKey[]
}): string {
  return `Ao permitir, o ${input.clientName} poderá consultar os dados do workspace ${input.workspaceName} nos módulos ${formatModuleList(input.modules)}, sempre com as suas permissões no Steel. As informações consultadas serão enviadas ao provedor desse aplicativo de IA e tratadas conforme a política de privacidade dele. Cada acesso fica registrado e você pode desconectar quando quiser em Ajustes › Segurança › Apps conectados.`
}

export const MCP_CONSENT_WRITE_NOTICE =
  'Com "Ler e alterar", o aplicativo também poderá criar e atualizar registros em seu nome, se o administrador do workspace liberar a escrita via MCP. Nada é excluído por esse acesso.'
