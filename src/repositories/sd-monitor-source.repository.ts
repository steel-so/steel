import type { Prisma, SdMonitorSource } from '@prisma/client'
import { sdMonitorSourceNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb, sdDbFind } from './sd-config-db'

export interface SdMonitorSourceData {
  name?: string
  kind?: SdMonitorSource['kind']
  active?: boolean
  ticketType?: SdMonitorSource['ticketType']
  departmentId?: string | null
  categoryId?: string | null
  customerId?: string | null
  severityMap?: Prisma.InputJsonValue
  autoResolve?: boolean
  flappingWindowMinutes?: number
  correlationMode?: SdMonitorSource['correlationMode']
  correlationWindowMinutes?: number
}

/**
 * Origens de monitoramento. O token nunca é guardado em claro: a coluna
 * `tokenHash` tem o SHA-256 e é única no banco inteiro, então a busca pela
 * entrada pública não precisa saber o workspace.
 *
 * Exclusão é lógica (`deletedAt`) para os alertas já recebidos não perderem
 * a origem; a origem excluída também para de responder ao token.
 */
export const SdMonitorSourceRepository = {
  async list(
    workspaceId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<Result<SdMonitorSource[]>> {
    return sdDb('Failed to list ServiceDesk monitor sources', () =>
      prisma.sdMonitorSource.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(options.includeInactive ? {} : { active: true }),
        },
        orderBy: { name: 'asc' },
      }),
    )
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdMonitorSource>> {
    return sdDbFind(
      'Failed to find ServiceDesk monitor source',
      () =>
        prisma.sdMonitorSource.findFirst({
          where: { id, workspaceId, deletedAt: null },
        }),
      sdMonitorSourceNotFound(),
    )
  },

  /** Origem ativa e não excluída pelo hash do token da URL pública. */
  async findByTokenHash(
    tokenHash: string,
  ): Promise<Result<SdMonitorSource | null>> {
    return sdDb('Failed to find ServiceDesk monitor source by token', () =>
      prisma.sdMonitorSource.findFirst({
        where: { tokenHash, deletedAt: null, active: true },
      }),
    )
  },

  async create(
    workspaceId: string,
    data: SdMonitorSourceData & {
      name: string
      tokenHash: string
      createdById: string
    },
  ): Promise<Result<SdMonitorSource>> {
    return sdDb('Failed to create ServiceDesk monitor source', () =>
      prisma.sdMonitorSource.create({ data: { ...data, workspaceId } }),
    )
  },

  async update(
    id: string,
    workspaceId: string,
    data: SdMonitorSourceData & { tokenHash?: string },
  ): Promise<Result<SdMonitorSource>> {
    return sdDb('Failed to update ServiceDesk monitor source', () =>
      prisma.sdMonitorSource.update({
        where: { id, workspaceId },
        data,
      }),
    )
  },

  /** Exclusão lógica: some das listas e o token deixa de valer. */
  async softDelete(id: string, workspaceId: string): Promise<Result<void>> {
    return sdDb('Failed to delete ServiceDesk monitor source', async () => {
      await prisma.sdMonitorSource.update({
        where: { id, workspaceId },
        data: { deletedAt: new Date(), active: false },
      })
    })
  },

  /** Carimba o último alerta recebido (fluxo público, sem usuário). */
  async touchLastEvent(id: string, at: Date): Promise<Result<void>> {
    return sdDb('Failed to touch ServiceDesk monitor source', async () => {
      await prisma.sdMonitorSource.update({
        where: { id },
        data: { lastEventAt: at },
      })
    })
  },
}
