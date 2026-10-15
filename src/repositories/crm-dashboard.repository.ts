import type {
  CrmDashboard,
  CrmDashboardTvLink,
  CrmDashboardWidget,
  CrmWidgetType,
  ModuleKind,
  Prisma,
} from '@prisma/client'
import { crmTvLinkNotFound, notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmDashboardRepository = {
  async listByWorkspace(
    workspaceId: string,
    module: ModuleKind,
  ): Promise<Result<CrmDashboard[]>> {
    try {
      const dashboards = await prisma.crmDashboard.findMany({
        where: { workspaceId, module, deletedAt: null },
        orderBy: { position: 'asc' },
      })
      return ok(dashboards)
    } catch (error) {
      return err(dbError('Failed to list CRM dashboards', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmDashboard>> {
    try {
      const dashboard = await prisma.crmDashboard.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!dashboard) return err(notFound('CrmDashboard'))
      return ok(dashboard)
    } catch (error) {
      return err(dbError('Failed to find CRM dashboard by id', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    title: string
    module: ModuleKind
    settings?: Prisma.InputJsonValue
  }): Promise<Result<CrmDashboard>> {
    try {
      const position = await prisma.crmDashboard.count({
        where: { workspaceId: data.workspaceId, deletedAt: null },
      })
      const dashboard = await prisma.crmDashboard.create({
        data: { ...data, position },
      })
      return ok(dashboard)
    } catch (error) {
      return err(dbError('Failed to create CRM dashboard', error))
    }
  },

  async update(
    id: string,
    data: {
      title?: string
      updatedById?: string
      settings?: Prisma.InputJsonValue
    },
  ): Promise<Result<CrmDashboard>> {
    try {
      const dashboard = await prisma.crmDashboard.update({
        where: { id },
        data,
      })
      return ok(dashboard)
    } catch (error) {
      return err(dbError('Failed to update CRM dashboard', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmDashboard.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM dashboard', error))
    }
  },

  async reorder(
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmDashboard.update({
            where: { id, workspaceId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder CRM dashboards', error))
    }
  },
}

export const CrmDashboardWidgetRepository = {
  async listByDashboard(
    dashboardId: string,
  ): Promise<Result<CrmDashboardWidget[]>> {
    try {
      const widgets = await prisma.crmDashboardWidget.findMany({
        where: { dashboardId },
        orderBy: [{ page: 'asc' }, { y: 'asc' }, { x: 'asc' }],
      })
      return ok(widgets)
    } catch (error) {
      return err(dbError('Failed to list CRM dashboard widgets', error))
    }
  },

  async findById(
    id: string,
    dashboardId: string,
  ): Promise<Result<CrmDashboardWidget>> {
    try {
      const widget = await prisma.crmDashboardWidget.findFirst({
        where: { id, dashboardId },
      })
      if (!widget) return err(notFound('CrmDashboardWidget'))
      return ok(widget)
    } catch (error) {
      return err(dbError('Failed to find CRM dashboard widget by id', error))
    }
  },

  async create(data: {
    dashboardId: string
    type: CrmWidgetType
    x?: number
    y?: number
    w?: number
    h?: number
    page?: number
    config: Prisma.InputJsonValue
  }): Promise<Result<CrmDashboardWidget>> {
    try {
      const widget = await prisma.crmDashboardWidget.create({ data })
      return ok(widget)
    } catch (error) {
      return err(dbError('Failed to create CRM dashboard widget', error))
    }
  },

  async update(
    id: string,
    data: {
      x?: number
      y?: number
      w?: number
      h?: number
      page?: number
      config?: Prisma.InputJsonValue
    },
  ): Promise<Result<CrmDashboardWidget>> {
    try {
      const widget = await prisma.crmDashboardWidget.update({
        where: { id },
        data,
      })
      return ok(widget)
    } catch (error) {
      return err(dbError('Failed to update CRM dashboard widget', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmDashboardWidget.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM dashboard widget', error))
    }
  },

  /** Aplica posições/tamanhos em lote (drag/resize do grid). */
  async applyLayout(
    dashboardId: string,
    items: {
      id: string
      x: number
      y: number
      w: number
      h: number
      page?: number
    }[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        items.map((item) =>
          prisma.crmDashboardWidget.updateMany({
            where: { id: item.id, dashboardId },
            data: {
              x: item.x,
              y: item.y,
              w: item.w,
              h: item.h,
              ...(item.page !== undefined ? { page: item.page } : {}),
            },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to apply CRM dashboard widget layout', error))
    }
  },
}

export const CrmDashboardTvLinkRepository = {
  async listByDashboard(
    dashboardId: string,
  ): Promise<Result<CrmDashboardTvLink[]>> {
    try {
      const links = await prisma.crmDashboardTvLink.findMany({
        where: { dashboardId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      })
      return ok(links)
    } catch (error) {
      return err(dbError('Failed to list CRM dashboard TV links', error))
    }
  },

  async findById(
    id: string,
    dashboardId: string,
  ): Promise<Result<CrmDashboardTvLink>> {
    try {
      const link = await prisma.crmDashboardTvLink.findFirst({
        where: { id, dashboardId, revokedAt: null },
      })
      if (!link) return err(crmTvLinkNotFound())
      return ok(link)
    } catch (error) {
      return err(dbError('Failed to find CRM dashboard TV link', error))
    }
  },

  /** Live link by token, with its dashboard (soft-deleted or not). */
  async findByToken(
    token: string,
  ): Promise<Result<CrmDashboardTvLink & { dashboard: CrmDashboard }>> {
    try {
      const link = await prisma.crmDashboardTvLink.findFirst({
        where: { token, revokedAt: null },
        include: { dashboard: true },
      })
      if (!link) return err(crmTvLinkNotFound())
      return ok(link)
    } catch (error) {
      return err(dbError('Failed to find CRM dashboard TV link', error))
    }
  },

  async create(data: {
    workspaceId: string
    dashboardId: string
    token: string
    name: string
    createdById: string
  }): Promise<Result<CrmDashboardTvLink>> {
    try {
      const link = await prisma.crmDashboardTvLink.create({ data })
      return ok(link)
    } catch (error) {
      return err(dbError('Failed to create CRM dashboard TV link', error))
    }
  },

  async revoke(id: string): Promise<Result<void>> {
    try {
      await prisma.crmDashboardTvLink.update({
        where: { id },
        data: { revokedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to revoke CRM dashboard TV link', error))
    }
  },

  async touch(id: string, at: Date): Promise<Result<void>> {
    try {
      await prisma.crmDashboardTvLink.update({
        where: { id },
        data: { lastUsedAt: at },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to touch CRM dashboard TV link', error))
    }
  },
}
