import type { SdInventoryAgentRelease } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb } from './sd-config-db'

export interface SdInventoryReleaseWriteData {
  version: string
  os: string
  arch: string
  sha256: string
  sizeBytes: number
  storageKey: string
}

/** Binários do agente publicados (globais, sem workspace). */
export const SdInventoryReleaseRepository = {
  /** A mais recente ativa para o sistema/arquitetura. */
  async findLatest(
    os: string,
    arch: string,
  ): Promise<Result<SdInventoryAgentRelease | null>> {
    return sdDb('Failed to find latest ServiceDesk agent release', () =>
      prisma.sdInventoryAgentRelease.findFirst({
        where: { os, arch, active: true },
        orderBy: { publishedAt: 'desc' },
      }),
    )
  },

  async findExact(
    version: string,
    os: string,
    arch: string,
  ): Promise<Result<SdInventoryAgentRelease | null>> {
    return sdDb('Failed to find ServiceDesk agent release', () =>
      prisma.sdInventoryAgentRelease.findFirst({
        where: { version, os, arch, active: true },
      }),
    )
  },

  /** Última ativa de cada sistema/arquitetura, para a tela de ajustes. */
  async listLatestPerTarget(): Promise<Result<SdInventoryAgentRelease[]>> {
    return sdDb('Failed to list ServiceDesk agent releases', async () => {
      const rows = await prisma.sdInventoryAgentRelease.findMany({
        where: { active: true },
        orderBy: { publishedAt: 'desc' },
      })
      const seen = new Set<string>()
      return rows.filter((row) => {
        const key = `${row.os}/${row.arch}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    })
  },

  /** Grava (ou republica) a versão: o mesmo `version/os/arch` é substituído. */
  async upsert(
    data: SdInventoryReleaseWriteData,
  ): Promise<Result<SdInventoryAgentRelease>> {
    return sdDb('Failed to publish ServiceDesk agent release', () =>
      prisma.sdInventoryAgentRelease.upsert({
        where: {
          version_os_arch: {
            version: data.version,
            os: data.os,
            arch: data.arch,
          },
        },
        create: data,
        update: { ...data, active: true, publishedAt: new Date() },
      }),
    )
  },
}
