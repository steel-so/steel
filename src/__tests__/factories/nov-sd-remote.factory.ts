import { createId } from '@paralleldrive/cuid2'
import type {
  SdRemoteEndpoint,
  SdRemoteSession,
  SdRemoteSettings,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SdRemoteSessionRow } from '@/src/repositories/sd-remote.repository'

/** Fábricas do acesso remoto integrado (S4). */

const fixed = () => new Date('2026-10-01T12:00:00.000Z')

export function createFakeSdRemoteSettings(
  overrides?: Partial<SdRemoteSettings>,
): SdRemoteSettings {
  return {
    workspaceId: 'ws1',
    enabled: true,
    provider: 'RUSTDESK',
    linkTemplate: null,
    updatedAt: fixed(),
    ...overrides,
  }
}

export function createFakeSdRemoteEndpoint(
  overrides?: Partial<SdRemoteEndpoint>,
): SdRemoteEndpoint {
  return {
    id: createId(),
    workspaceId: 'ws1',
    configItemId: 'ci1',
    provider: 'RUSTDESK',
    remoteId: '123456789',
    source: 'MANUAL',
    createdAt: fixed(),
    updatedAt: fixed(),
    ...overrides,
  }
}

export function createFakeSdRemoteSession(
  overrides?: Partial<SdRemoteSessionRow>,
): SdRemoteSessionRow {
  const base: SdRemoteSession = {
    id: createId(),
    workspaceId: 'ws1',
    configItemId: 'ci1',
    ticketId: null,
    userId: 'u1',
    provider: 'RUSTDESK',
    remoteId: '123456789',
    startedAt: fixed(),
  }
  return { ...base, user: { id: 'u1', name: 'Ana Técnica' }, ...overrides }
}

export async function seedSdRemoteEndpoint(input: {
  workspaceId: string
  configItemId: string
  provider?: 'RUSTDESK' | 'ANYDESK'
  remoteId?: string
  source?: 'MANUAL' | 'INVENTORY'
}): Promise<SdRemoteEndpoint> {
  return prisma.sdRemoteEndpoint.create({
    data: {
      workspaceId: input.workspaceId,
      configItemId: input.configItemId,
      provider: input.provider ?? 'RUSTDESK',
      remoteId: input.remoteId ?? '123456789',
      source: input.source ?? 'MANUAL',
    },
  })
}

export async function seedSdRemoteSettings(
  workspaceId: string,
  data?: Partial<
    Pick<SdRemoteSettings, 'enabled' | 'provider' | 'linkTemplate'>
  >,
): Promise<SdRemoteSettings> {
  return prisma.sdRemoteSettings.create({
    data: { workspaceId, enabled: true, ...data },
  })
}
