import { createHash } from 'node:crypto'
import { logger } from '@/lib/axiom/logger'
import {
  sdInventoryReleaseInvalid,
  sdInventoryTokenInvalid,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { ensureBucket, getObject, putObject } from '@/src/lib/storage/s3'
import { toSdInventoryAgentReleaseDTO } from '@/src/mappers/sd-inventory.mapper'
import { SdInventoryReleaseRepository } from '@/src/repositories/sd-inventory-release.repository'
import { SdInventoryTokenRepository } from '@/src/repositories/sd-inventory-token.repository'
import {
  type PublishSdInventoryAgentReleaseDTO,
  PublishSdInventoryAgentReleaseSchema,
  type SdInventoryAgentDownloadQueryDTO,
  type SdInventoryAgentVersionQueryDTO,
} from '@/src/schemas/sd-inventory.schema'
import type {
  SdInventoryAgentReleaseDTO,
  SdInventoryAgentVersionDTO,
} from '@/types/sd-inventory'
import { assertModuleEnabled } from './authz'
import { SdAccess } from './sd-access'
import { SdInventorySettingsService } from './sd-inventory-settings.service'
import { hashSdInventoryToken } from './sd-inventory-token.service'

/** Bucket privado dos binários do agente (servidos só por este service). */
export const SD_INVENTORY_AGENT_BUCKET = 'inventory-agent'
/** Teto de um binário publicado. */
export const SD_INVENTORY_AGENT_MAX_BYTES = 64 * 1024 * 1024

const NO_UPDATE: SdInventoryAgentVersionDTO = {
  updateAvailable: false,
  version: null,
  sha256: null,
  size: null,
  downloadPath: null,
}

export function sdInventoryAgentStorageKey(
  release: Pick<PublishSdInventoryAgentReleaseDTO, 'version' | 'os' | 'arch'>,
): string {
  const ext = release.os === 'windows' ? '.exe' : ''
  return `${release.version}/steel-inventory-agent-${release.os}-${release.arch}${ext}`
}

export function sdInventoryAgentDownloadPath(
  query: SdInventoryAgentDownloadQueryDTO,
): string {
  const params = new URLSearchParams({
    os: query.os,
    arch: query.arch,
    version: query.version,
  })
  return `/api/servicedesk/inventory/agent/download?${params.toString()}`
}

/**
 * Atualização automática do agente de inventário. O agente (token por
 * workspace) pergunta a versão e baixa o binário; o SHA-256 vem do banco, o
 * agente confere antes de se trocar. Desligada por padrão por workspace.
 */
export const SdInventoryAgentUpdateService = {
  /** Token → workspace, com o módulo ServiceDesk ligado. */
  async authorize(
    tokenValue: string,
  ): Promise<Result<{ workspaceId: string }>> {
    const found = await SdInventoryTokenRepository.findActiveByHash(
      hashSdInventoryToken(tokenValue),
    )
    if (!found.ok) return found
    if (!found.value) return err(sdInventoryTokenInvalid())
    const { workspaceId } = found.value

    const enabled = await assertModuleEnabled(workspaceId, 'SERVICE_DESK')
    if (!enabled.ok) return enabled
    return ok({ workspaceId })
  },

  async checkVersion(
    tokenValue: string,
    query: SdInventoryAgentVersionQueryDTO,
  ): Promise<Result<SdInventoryAgentVersionDTO>> {
    const auth = await SdInventoryAgentUpdateService.authorize(tokenValue)
    if (!auth.ok) return auth
    const settings = await SdInventorySettingsService.load(
      auth.value.workspaceId,
    )
    if (!settings.ok) return settings
    // Build de desenvolvimento nunca se atualiza sozinho.
    if (!settings.value.agentAutoUpdate || query.current === 'dev') {
      return ok(NO_UPDATE)
    }

    const latest = await SdInventoryReleaseRepository.findLatest(
      query.os,
      query.arch,
    )
    if (!latest.ok) return latest
    if (!latest.value || latest.value.version === query.current) {
      return ok(NO_UPDATE)
    }
    return ok({
      updateAvailable: true,
      version: latest.value.version,
      sha256: latest.value.sha256,
      size: latest.value.sizeBytes,
      downloadPath: sdInventoryAgentDownloadPath({
        os: query.os,
        arch: query.arch,
        version: latest.value.version,
      }),
    })
  },

  async download(
    tokenValue: string,
    query: SdInventoryAgentDownloadQueryDTO,
  ): Promise<Result<{ body: Buffer; sha256: string; filename: string }>> {
    const auth = await SdInventoryAgentUpdateService.authorize(tokenValue)
    if (!auth.ok) return auth
    const settings = await SdInventorySettingsService.load(
      auth.value.workspaceId,
    )
    if (!settings.ok) return settings
    if (!settings.value.agentAutoUpdate) {
      return err(
        sdInventoryReleaseInvalid(
          'A atualização automática do agente está desligada nesta workspace',
        ),
      )
    }

    const release = await SdInventoryReleaseRepository.findExact(
      query.version,
      query.os,
      query.arch,
    )
    if (!release.ok) return release
    if (!release.value) {
      return err(sdInventoryReleaseInvalid('Versão do agente não encontrada'))
    }

    let body: Buffer
    try {
      body = await getObject({
        bucket: SD_INVENTORY_AGENT_BUCKET,
        key: release.value.storageKey,
      })
    } catch (error) {
      logger.error('servicedesk.inventory.agent_download_failed', {
        version: query.version,
        error: error instanceof Error ? error.message : String(error),
      })
      return err(sdInventoryReleaseInvalid('Binário do agente indisponível'))
    }
    // Nunca entrega um arquivo que não bate com o SHA-256 publicado.
    const sha256 = createHash('sha256').update(body).digest('hex')
    if (sha256 !== release.value.sha256) {
      logger.error('servicedesk.inventory.agent_checksum_mismatch', {
        version: query.version,
      })
      return err(sdInventoryReleaseInvalid('Binário do agente corrompido'))
    }
    return ok({
      body,
      sha256,
      filename: release.value.storageKey.split('/').pop() ?? 'agent',
    })
  },

  /** Última versão publicada por sistema, para a tela de ajustes. */
  async listLatest(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdInventoryAgentReleaseDTO[]>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdInventoryReleaseRepository.listLatestPerTarget()
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdInventoryAgentReleaseDTO))
  },

  /**
   * Publica um binário (script do operador do servidor; sem rota pública).
   * Calcula o SHA-256 aqui, grava no bucket privado e registra a versão.
   */
  async publish(
    input: PublishSdInventoryAgentReleaseDTO & { binary: Buffer },
  ): Promise<Result<SdInventoryAgentReleaseDTO>> {
    const parsed = PublishSdInventoryAgentReleaseSchema.safeParse(input)
    if (!parsed.success) {
      return err(
        sdInventoryReleaseInvalid(
          parsed.error.issues[0]?.message ?? 'Versão do agente inválida',
        ),
      )
    }
    if (
      input.binary.length === 0 ||
      input.binary.length > SD_INVENTORY_AGENT_MAX_BYTES
    ) {
      return err(sdInventoryReleaseInvalid('Binário vazio ou grande demais'))
    }

    const storageKey = sdInventoryAgentStorageKey(parsed.data)
    try {
      await ensureBucket(SD_INVENTORY_AGENT_BUCKET)
      await putObject({
        bucket: SD_INVENTORY_AGENT_BUCKET,
        key: storageKey,
        body: input.binary,
        contentType: 'application/octet-stream',
      })
    } catch (error) {
      logger.error('servicedesk.inventory.agent_publish_failed', {
        version: parsed.data.version,
        error: error instanceof Error ? error.message : String(error),
      })
      return err(sdInventoryReleaseInvalid('Não foi possível gravar o binário'))
    }

    const saved = await SdInventoryReleaseRepository.upsert({
      ...parsed.data,
      sha256: createHash('sha256').update(input.binary).digest('hex'),
      sizeBytes: input.binary.length,
      storageKey,
    })
    if (!saved.ok) return saved
    return ok(toSdInventoryAgentReleaseDTO(saved.value))
  },
}
