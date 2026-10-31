import type { Prisma, SteelMcpServer } from '@prisma/client'
import { steelMcpServerNotFound } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** External MCP servers a workspace registered for its agents (A8). */
export const SteelMcpServerRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<SteelMcpServer[]>> {
    try {
      return ok(
        await prisma.steelMcpServer.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list steel MCP servers', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SteelMcpServer>> {
    try {
      const server = await prisma.steelMcpServer.findFirst({
        where: { id, workspaceId },
      })
      if (!server) return err(steelMcpServerNotFound())
      return ok(server)
    } catch (error) {
      return err(dbError('Failed to find steel MCP server', error))
    }
  },

  async create(
    data: Prisma.SteelMcpServerUncheckedCreateInput,
  ): Promise<Result<SteelMcpServer>> {
    try {
      return ok(await prisma.steelMcpServer.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create steel MCP server', error))
    }
  },

  async update(
    id: string,
    data: Prisma.SteelMcpServerUncheckedUpdateInput,
  ): Promise<Result<SteelMcpServer>> {
    try {
      return ok(await prisma.steelMcpServer.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update steel MCP server', error))
    }
  },

  async delete(id: string): Promise<Result<true>> {
    try {
      await prisma.steelMcpServer.delete({ where: { id } })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to delete steel MCP server', error))
    }
  },
}
