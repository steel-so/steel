import type { ModuleKind, Profile, Role, WorkspaceStatus } from '@prisma/client'
import { headers } from 'next/headers'
import { logger } from '@/lib/axiom/logger'
import {
  forbidden,
  moduleDisabled,
  workspaceIpNotAllowed,
  workspaceSuspended,
} from '../errors'
import { clientIpFrom } from '../lib/analytics/geoip'
import {
  annotateRequest,
  currentRequestContext,
} from '../lib/analytics/request-context'
import { isIpAllowed } from '../lib/ip-allowlist'
import {
  can,
  type PermissionAction,
  type PermissionMap,
  SYSTEM_PROFILE_PERMISSIONS,
} from '../lib/permissions'
import { PATHNAME_REQUEST_HEADER } from '../lib/request-path'
import { err, ok, type Result } from '../lib/result'
import { MembershipRepository } from '../repositories/membership.repository'
import { UserRepository } from '../repositories/user.repository'
import { WorkspaceModuleAccessRepository } from '../repositories/workspace-module-access.repository'
import { recordWorkspaceAccess } from './workspace-access-recorder'

export const PRIVILEGED_ROLES = ['OWNER', 'ADMIN'] as const

/**
 * Domínio de e-mail exigido do admin global, além da flag `isPlatformAdmin`.
 * Segunda camada de defesa: a flag sozinha já basta, mas exigir o domínio
 * também barra o caso de a flag vazar/ficar esquecida numa conta errada.
 */
const PLATFORM_ADMIN_EMAIL_DOMAIN = '@stratustelecom.com.br'

export interface PlatformAdminContext {
  userId: string
  email: string
}

export function isPrivilegedRole(role: Role): boolean {
  return (PRIVILEGED_ROLES as readonly string[]).includes(role)
}

export interface MembershipContext {
  role: Role
  isPrivileged: boolean
  /** Permissões efetivas (perfil, ou fallback do papel), ou `null`. */
  permissions: PermissionMap | null
}

export interface PermissionRequirement {
  resource: string
  action: PermissionAction
}

/**
 * Permissões efetivas de uma membership. Perfis de sistema usam a matriz do
 * código (fonte da verdade — o JSON salvo é só um snapshot da época do seed e
 * não acompanha recursos novos); perfis customizados usam o que foi salvo; sem
 * perfil, cai na matriz do papel. `null` = nada definido → negado.
 */
export function resolvePermissions(
  role: Role,
  profile: Pick<Profile, 'isSystem' | 'systemKey' | 'permissions'> | null,
): PermissionMap | null {
  if (profile) {
    if (profile.isSystem && profile.systemKey) {
      const system = SYSTEM_PROFILE_PERMISSIONS[profile.systemKey]
      if (system) return system
    }
    return (profile.permissions as PermissionMap | null) ?? null
  }
  return SYSTEM_PROFILE_PERMISSIONS[role] ?? null
}

/**
 * Gate central de suspensão: workspace `SUSPENDED` (ou `DELETING`, exclusão em
 * andamento) bloqueia todo membro, em toda API que passa por `assertMember`.
 * Status ausente (mocks antigos, selects parciais) conta como ativo.
 */
export function assertWorkspaceActive(
  status: WorkspaceStatus | null | undefined,
): Result<true> {
  if (!status || status === 'ACTIVE') return ok(true)
  if (status === 'DELETING') {
    return err(workspaceSuspended('Este workspace está sendo excluído.'))
  }
  return err(workspaceSuspended())
}

/**
 * Allowlist de rede do workspace. Lista vazia/ausente libera tudo; preenchida,
 * nega quando o IP é desconhecido (fail-closed). Fora de uma requisição
 * (worker, scripts) não há IP a avaliar e a checagem é ignorada.
 *
 * With an allowlist, every decision (allowed or blocked) also goes to the
 * entry log (ADR 0053), fire-and-forget and deduplicated in Redis, so the
 * request never waits for it. The surface comes from the path the proxy
 * stamped (`/api/*` → API, anything else → APP); without it, a route
 * handler (inside `withAxiom`) counts as API and a Server Component as APP.
 */
export async function assertIpAllowed(
  workspaceId: string,
  allowedIps: string[] | null | undefined,
  actorId: string,
): Promise<Result<true>> {
  if (!allowedIps || allowedIps.length === 0) return ok(true)

  let reqHeaders: Headers
  try {
    reqHeaders = await headers()
  } catch {
    return ok(true)
  }

  const ip = clientIpFrom(reqHeaders)
  const allowed = isIpAllowed(ip, allowedIps)
  const path = reqHeaders.get(PATHNAME_REQUEST_HEADER) || null
  const isApi = path
    ? path === '/api' || path.startsWith('/api/')
    : currentRequestContext() !== undefined
  void recordWorkspaceAccess({
    workspaceId,
    userId: actorId,
    ip,
    userAgent: reqHeaders.get('user-agent'),
    outcome: allowed ? 'ALLOWED' : 'BLOCKED',
    surface: isApi ? 'API' : 'APP',
    path,
  })
  if (allowed) return ok(true)

  logger.warn('workspace.ip_blocked', { workspaceId, actorId, ip })
  return err(workspaceIpNotAllowed())
}

/**
 * Verifica associação ao workspace e, opcionalmente, uma permissão específica
 * (recurso × ação). Sem `require`, só confirma associação. Com `require`, a
 * regra é **negação por padrão**: se a matriz efetiva não conceder a ação
 * explicitamente (ou não houver matriz), bloqueia. Membros com role
 * privilegiado (OWNER/ADMIN) sempre passam.
 */
export async function assertMember(
  actorId: string,
  workspaceId: string,
  require?: PermissionRequirement,
): Promise<Result<MembershipContext>> {
  const membership = await MembershipRepository.findByUserAndWorkspace(
    actorId,
    workspaceId,
  )
  if (!membership.ok) return membership
  if (!membership.value) return err(forbidden())

  // Depois da associação: não revela a um não-membro que o workspace existe.
  const active = assertWorkspaceActive(membership.value.workspace?.status)
  if (!active.ok) return active
  const network = await assertIpAllowed(
    workspaceId,
    membership.value.workspace?.allowedIps,
    actorId,
  )
  if (!network.ok) return network
  // Workspaces únicos do painel Analytics (no-op fora de uma rota de API).
  annotateRequest({ workspaceId })

  const isPrivileged = isPrivilegedRole(membership.value.role)
  const permissions = resolvePermissions(
    membership.value.role,
    membership.value.profile,
  )

  return authorize(
    { role: membership.value.role, isPrivileged, permissions },
    require,
  )
}

function authorize(
  ctx: MembershipContext,
  require?: PermissionRequirement,
): Result<MembershipContext> {
  if (require && !ctx.isPrivileged) {
    // Negação por padrão: sem matriz ou sem a ação concedida → bloqueado.
    if (
      !ctx.permissions ||
      !can(ctx.permissions, require.resource, require.action)
    ) {
      return err(forbidden())
    }
  }
  return ok(ctx)
}

/**
 * Barra o acesso quando o módulo não está habilitado para a workspace. Não
 * exige sessão — é usado também pelas rotas públicas (formulários, propostas,
 * landing pages, webhooks) depois de resolverem a workspace pelo token.
 */
export async function assertModuleEnabled(
  workspaceId: string,
  module: ModuleKind,
): Promise<Result<true>> {
  const enabled = await WorkspaceModuleAccessRepository.isEnabled(
    workspaceId,
    module,
  )
  if (!enabled.ok) return enabled
  if (!enabled.value) return err(moduleDisabled())
  return ok(true)
}

/**
 * Porta de entrada de autorização dos services de módulo (CRM, Comunicação):
 * associação ao workspace → módulo habilitado → permissão (recurso × ação).
 * A associação vem primeiro para não revelar a um não-membro se o módulo
 * está ativo. Sem `require`, vale só associação + módulo (leituras de apoio,
 * como a lista de membros para atribuição).
 */
export async function assertModuleMember(
  actorId: string,
  workspaceId: string,
  module: ModuleKind,
  require?: PermissionRequirement,
): Promise<Result<MembershipContext>> {
  const membership = await assertMember(actorId, workspaceId)
  if (!membership.ok) return membership

  const enabled = await assertModuleEnabled(workspaceId, module)
  if (!enabled.ok) return enabled

  return authorize(membership.value, require)
}

/**
 * Ações de administração de um módulo (chaves de integração, metas, conexões
 * e IA do WhatsApp): módulo habilitado + papel OWNER/ADMIN.
 */
export async function assertModulePrivileged(
  actorId: string,
  workspaceId: string,
  module: ModuleKind,
): Promise<Result<MembershipContext>> {
  const membership = await assertModuleMember(actorId, workspaceId, module)
  if (!membership.ok) return membership
  if (!membership.value.isPrivileged) return err(forbidden())
  return ok(membership.value)
}

export async function assertPrivileged(
  actorId: string,
  workspaceId: string,
): Promise<Result<MembershipContext>> {
  const membership = await assertMember(actorId, workspaceId)
  if (!membership.ok) return membership
  if (!membership.value.isPrivileged) return err(forbidden())
  return ok(membership.value)
}

/**
 * Verifica acesso ao painel admin global (fora do escopo de qualquer
 * workspace). Exige a flag `isPlatformAdmin` **e** o e-mail no domínio da
 * Stratus Telecom — as duas condições, não uma ou outra.
 */
export async function assertPlatformAdmin(
  actorId: string,
): Promise<Result<PlatformAdminContext>> {
  const user = await UserRepository.findById(actorId)
  if (!user.ok) return user

  if (
    !user.value.isPlatformAdmin ||
    !user.value.email.toLowerCase().endsWith(PLATFORM_ADMIN_EMAIL_DOMAIN)
  ) {
    return err(forbidden())
  }

  return ok({ userId: user.value.id, email: user.value.email })
}
