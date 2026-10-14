import type { PermissionAction } from '@/src/lib/permissions'
import type { ErrorEntry } from '../../registry'

/**
 * Peças comuns das rotas da Comunicação (`/workspaces/{id}/whatsapp/**`).
 * Toda rota exige sessão, membro ativo de workspace não suspenso e o módulo
 * `COMMUNICATION` habilitado (`assertModuleMember`/`assertModulePrivileged`
 * em `src/services/authz.ts`).
 */

/** Descrição de autorização por permissão (recurso × ação do RBAC). */
export function perm(resource: string, action: PermissionAction): string {
  return `Módulo **Comunicação** habilitado e permissão \`${resource}\` × \`${action}\` no perfil (OWNER/ADMIN sempre passam).`
}

/** Ações de administração (conexões, IA, templates, configurações). */
export const PRIVILEGED =
  'Módulo **Comunicação** habilitado; restrito a OWNER/ADMIN do workspace.'

/** Membro + módulo, sem permissão específica. */
export const MEMBER = 'Módulo **Comunicação** habilitado; qualquer membro.'

/** Erros de acesso de uma rota com permissão `resource × action`. */
export function permErrors(
  resource: string,
  action: PermissionAction,
): ErrorEntry[] {
  return [
    {
      code: 'FORBIDDEN',
      when: `Não é membro do workspace ou o perfil não concede \`${resource}\` × \`${action}\``,
    },
    'WORKSPACE_SUSPENDED',
    'MODULE_DISABLED',
  ]
}

/** Erros de acesso das rotas restritas a OWNER/ADMIN. */
export const PRIVILEGED_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'Não é membro ou não é OWNER/ADMIN' },
  'WORKSPACE_SUSPENDED',
  'MODULE_DISABLED',
]

/** Erros de acesso das rotas abertas a qualquer membro do módulo. */
export const MEMBER_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'Usuário não é membro do workspace' },
  'WORKSPACE_SUSPENDED',
  'MODULE_DISABLED',
]

/** Falha no provedor (Z-API/Meta) ou limite de envio por conexão. */
export const SEND_ERRORS: ErrorEntry[] = [
  {
    code: 'WHATSAPP_PROVIDER_ERROR',
    when: 'O provedor (Z-API/Meta) recusou ou falhou o envio',
  },
  {
    code: 'RATE_LIMITED',
    message: 'Muitas requisições',
    when: 'Limite de envio da conexão (20 mensagens/min) excedido',
  },
  {
    code: 'WHATSAPP_MESSAGE_LIMIT_REACHED',
    when: 'O limite mensal de mensagens do workspace foi atingido (Ajustes › Comunicação)',
  },
]

export const SEND_NOTE =
  'O envio passa pelo provedor da conexão (Z-API ou Meta Cloud API) e consome também o limite de envio **por conexão** (20 mensagens/min).'

export const CONVERSATION_PARAM = 'Id da conversa.'
export const CONNECTION_PARAM = 'Id da conexão do WhatsApp.'
export const CONTACT_PARAM = 'Id do contato do WhatsApp.'
export const GROUP_PARAM = 'Id do grupo do WhatsApp.'
