import type { SteelMcpServer } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { steelMcpServerInvalid } from '@/src/errors/app-error'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { discoverMcpTools } from '@/src/lib/steel-agents/mcp-client'
import {
  MAX_MCP_SERVERS,
  mcpSlugFrom,
  parseToolsCache,
} from '@/src/lib/steel-agents/mcp-tools'
import { checkWebhookUrl, webhookUrlError } from '@/src/lib/webhooks/url-guard'
import { toSteelMcpServerDTO } from '@/src/mappers/steel-mcp-server.mapper'
import { SteelMcpServerRepository } from '@/src/repositories/steel-mcp-server.repository'
import type {
  CreateSteelMcpServerDTO,
  UpdateSteelMcpServerDTO,
} from '@/src/schemas/steel-mcp-server.schema'
import type { SteelMcpServerDTO } from '@/types/steel-mcp'
import { assertPrivileged } from './authz'

/**
 * Admin CRUD of the external MCP servers (A8). OWNER/ADMIN only: the server
 * receives a secret and the platform calls out to it. The URL goes through
 * the webhook SSRF guard on save and on every request; the secret is
 * encrypted with CONNECTION_SECRETS and never returned. Discovery
 * (`tools/list`) fills the cache the allow-list is picked from.
 */

async function checkUrl(url: string): Promise<Result<string>> {
  const checked = await checkWebhookUrl(url)
  if (!checked.ok) {
    return err(steelMcpServerInvalid(webhookUrlError(checked.reason).message))
  }
  return ok(checked.url.toString())
}

async function pickSlug(
  workspaceId: string,
  name: string,
): Promise<Result<string>> {
  const all = await SteelMcpServerRepository.listByWorkspace(workspaceId)
  if (!all.ok) return all
  if (all.value.length >= MAX_MCP_SERVERS) {
    return err(
      steelMcpServerInvalid(
        `Limite de ${MAX_MCP_SERVERS} servidores MCP por workspace atingido.`,
      ),
    )
  }
  const taken = new Set(all.value.map((s) => s.slug))
  const base = mcpSlugFrom(name)
  let slug = base
  for (let n = 2; taken.has(slug); n++) {
    slug = `${base.slice(0, 13)}${n}`
  }
  return ok(slug)
}

/** `tools/list` → cache + prune of the allow-list. Never throws. */
async function discover(server: SteelMcpServer): Promise<SteelMcpServer> {
  let headerValue: string | null = null
  try {
    headerValue = server.encryptedAuthValue
      ? await decryptConnectionSecret(server.encryptedAuthValue)
      : null
  } catch {
    const failed = await SteelMcpServerRepository.update(server.id, {
      lastError: 'Não foi possível ler as credenciais guardadas.',
    })
    return failed.ok ? failed.value : server
  }
  const found = await discoverMcpTools({
    url: server.url,
    headerName: server.authHeaderName,
    headerValue,
  })
  if (!found.ok) {
    logger.warn(
      'steel_agents.mcp_discovery_failed',
      logFields(
        { component: 'SteelMcpServerService', workspaceId: server.workspaceId },
        { serverId: server.id },
      ),
    )
    const failed = await SteelMcpServerRepository.update(server.id, {
      lastError: found.error.message,
    })
    return failed.ok ? failed.value : server
  }
  const names = new Set(found.value.map((tool) => tool.name))
  const saved = await SteelMcpServerRepository.update(server.id, {
    toolsCache: found.value as unknown as object,
    discoveredAt: new Date(),
    lastError: null,
    allowedTools: server.allowedTools.filter((name) => names.has(name)),
  })
  return saved.ok ? saved.value : server
}

export const SteelMcpServerService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SteelMcpServerDTO[]>> {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const servers = await SteelMcpServerRepository.listByWorkspace(workspaceId)
    if (!servers.ok) return servers
    return ok(servers.value.map(toSteelMcpServerDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSteelMcpServerDTO,
  ): Promise<Result<SteelMcpServerDTO>> {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const url = await checkUrl(dto.url)
    if (!url.ok) return url
    const slug = await pickSlug(workspaceId, dto.name)
    if (!slug.ok) return slug

    const created = await SteelMcpServerRepository.create({
      workspaceId,
      name: dto.name,
      slug: slug.value,
      url: url.value,
      authHeaderName: dto.authHeaderName,
      encryptedAuthValue: dto.authValue
        ? await encryptConnectionSecret(dto.authValue)
        : null,
      enabled: dto.enabled,
      allowedTools: [],
      createdById: actorId,
    })
    if (!created.ok) return created
    const server = await discover(created.value)
    // Names the admin sent are honored only if the server really has them.
    let final = server
    if (dto.allowedTools.length > 0) {
      const known = new Set(
        parseToolsCache(server.toolsCache).map((t) => t.name),
      )
      const allowed = dto.allowedTools.filter((name) => known.has(name))
      const updated = await SteelMcpServerRepository.update(server.id, {
        allowedTools: allowed,
      })
      if (updated.ok) final = updated.value
    }
    auditMutation({
      entity: 'steel_mcp_server',
      action: 'create',
      actorId,
      targetId: final.id,
      meta: {
        workspaceId,
        host: new URL(final.url).host,
        hasAuth: Boolean(dto.authValue),
      },
    })
    return ok(toSteelMcpServerDTO(final))
  },

  async update(
    actorId: string,
    workspaceId: string,
    serverId: string,
    dto: UpdateSteelMcpServerDTO,
  ): Promise<Result<SteelMcpServerDTO>> {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const current = await SteelMcpServerRepository.findById(
      serverId,
      workspaceId,
    )
    if (!current.ok) return current

    const data: Parameters<typeof SteelMcpServerRepository.update>[1] = {}
    let urlChanged = false
    if (dto.url !== undefined) {
      const url = await checkUrl(dto.url)
      if (!url.ok) return url
      urlChanged = url.value !== current.value.url
      data.url = url.value
    }
    if (dto.name !== undefined) data.name = dto.name
    if (dto.enabled !== undefined) data.enabled = dto.enabled
    if (dto.authHeaderName !== undefined)
      data.authHeaderName = dto.authHeaderName
    if (dto.authValue !== undefined) {
      data.encryptedAuthValue = dto.authValue
        ? await encryptConnectionSecret(dto.authValue)
        : null
    }
    if (dto.allowedTools !== undefined) {
      const known = new Set(
        parseToolsCache(current.value.toolsCache).map((t) => t.name),
      )
      const unknown = dto.allowedTools.find((name) => !known.has(name))
      if (unknown) {
        return err(
          steelMcpServerInvalid(
            `A ferramenta "${unknown}" não existe neste servidor. Atualize a lista de ferramentas.`,
          ),
        )
      }
      data.allowedTools = dto.allowedTools
    }
    // A new endpoint means a new tool set: nothing stays released.
    if (urlChanged) {
      data.allowedTools = []
      data.toolsCache = []
      data.discoveredAt = null
    }

    const updated = await SteelMcpServerRepository.update(serverId, data)
    if (!updated.ok) return updated
    auditMutation({
      entity: 'steel_mcp_server',
      action: 'update',
      actorId,
      targetId: serverId,
      meta: {
        workspaceId,
        fields: Object.keys(dto).filter((k) => k !== 'authValue'),
        secretChanged: dto.authValue !== undefined,
        ...(dto.allowedTools && { allowedTools: dto.allowedTools }),
      },
    })
    return ok(toSteelMcpServerDTO(updated.value))
  },

  /** "Atualizar ferramentas": runs the discovery again. */
  async refresh(
    actorId: string,
    workspaceId: string,
    serverId: string,
  ): Promise<Result<SteelMcpServerDTO>> {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const current = await SteelMcpServerRepository.findById(
      serverId,
      workspaceId,
    )
    if (!current.ok) return current
    const checked = await checkUrl(current.value.url)
    if (!checked.ok) return checked
    const server = await discover(current.value)
    auditMutation({
      entity: 'steel_mcp_server',
      action: 'sync',
      actorId,
      targetId: serverId,
      outcome: server.lastError ? 'failure' : 'success',
      meta: { workspaceId, tools: parseToolsCache(server.toolsCache).length },
    })
    return ok(toSteelMcpServerDTO(server))
  },

  async delete(
    actorId: string,
    workspaceId: string,
    serverId: string,
  ): Promise<Result<SteelMcpServerDTO>> {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const current = await SteelMcpServerRepository.findById(
      serverId,
      workspaceId,
    )
    if (!current.ok) return current
    const deleted = await SteelMcpServerRepository.delete(serverId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'steel_mcp_server',
      action: 'delete',
      actorId,
      targetId: serverId,
      meta: { workspaceId, name: current.value.name },
    })
    return ok(toSteelMcpServerDTO(current.value))
  },
}
