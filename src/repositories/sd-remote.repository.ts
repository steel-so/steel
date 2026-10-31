import type {
  Prisma,
  SdRemoteEndpoint,
  SdRemoteProvider,
  SdRemoteSession,
  SdRemoteSettings,
} from '@prisma/client'
import { sdRemoteEndpointNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb, sdDbFind } from './sd-config-db'

export type SdRemoteSessionRow = SdRemoteSession & {
  user: { id: string; name: string }
}

const SESSION_INCLUDE = {
  user: { select: { id: true, name: true } },
} satisfies Prisma.SdRemoteSessionInclude

export interface SdRemoteSettingsData {
  enabled?: boolean
  provider?: SdRemoteProvider
  linkTemplate?: string | null
}

export const SdRemoteRepository = {
  async findSettings(
    workspaceId: string,
  ): Promise<Result<SdRemoteSettings | null>> {
    return sdDb('Failed to find ServiceDesk remote access settings', () =>
      prisma.sdRemoteSettings.findUnique({ where: { workspaceId } }),
    )
  },

  async upsertSettings(
    workspaceId: string,
    data: SdRemoteSettingsData,
  ): Promise<Result<SdRemoteSettings>> {
    return sdDb('Failed to save ServiceDesk remote access settings', () =>
      prisma.sdRemoteSettings.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data,
      }),
    )
  },

  async listEndpoints(
    workspaceId: string,
    configItemId: string,
  ): Promise<Result<SdRemoteEndpoint[]>> {
    return sdDb('Failed to list ServiceDesk remote endpoints', () =>
      prisma.sdRemoteEndpoint.findMany({
        where: { workspaceId, configItemId },
        orderBy: { provider: 'asc' },
      }),
    )
  },

  async findEndpoint(
    workspaceId: string,
    configItemId: string,
    provider: SdRemoteProvider,
  ): Promise<Result<SdRemoteEndpoint>> {
    return sdDbFind(
      'Failed to find ServiceDesk remote endpoint',
      () =>
        prisma.sdRemoteEndpoint.findFirst({
          where: { workspaceId, configItemId, provider },
        }),
      sdRemoteEndpointNotFound(),
    )
  },

  async findEndpointById(
    workspaceId: string,
    id: string,
  ): Promise<Result<SdRemoteEndpoint>> {
    return sdDbFind(
      'Failed to find ServiceDesk remote endpoint',
      () => prisma.sdRemoteEndpoint.findFirst({ where: { id, workspaceId } }),
      sdRemoteEndpointNotFound(),
    )
  },

  async upsertEndpoint(data: {
    workspaceId: string
    configItemId: string
    provider: SdRemoteProvider
    remoteId: string
    source: 'MANUAL' | 'INVENTORY'
  }): Promise<Result<SdRemoteEndpoint>> {
    const { workspaceId, configItemId, provider, remoteId, source } = data
    return sdDb('Failed to save ServiceDesk remote endpoint', () =>
      prisma.sdRemoteEndpoint.upsert({
        where: { configItemId_provider: { configItemId, provider } },
        create: { workspaceId, configItemId, provider, remoteId, source },
        update: { remoteId, source },
      }),
    )
  },

  async deleteEndpoint(id: string): Promise<Result<SdRemoteEndpoint>> {
    return sdDb('Failed to delete ServiceDesk remote endpoint', () =>
      prisma.sdRemoteEndpoint.delete({ where: { id } }),
    )
  },

  async createSession(data: {
    workspaceId: string
    configItemId: string
    ticketId: string | null
    userId: string
    provider: SdRemoteProvider
    remoteId: string
  }): Promise<Result<SdRemoteSessionRow>> {
    return sdDb('Failed to record ServiceDesk remote session', () =>
      prisma.sdRemoteSession.create({ data, include: SESSION_INCLUDE }),
    )
  },

  async listSessions(
    workspaceId: string,
    configItemId: string,
    limit: number,
  ): Promise<Result<SdRemoteSessionRow[]>> {
    return sdDb('Failed to list ServiceDesk remote sessions', () =>
      prisma.sdRemoteSession.findMany({
        where: { workspaceId, configItemId },
        orderBy: { startedAt: 'desc' },
        take: limit,
        include: SESSION_INCLUDE,
      }),
    )
  },
}
