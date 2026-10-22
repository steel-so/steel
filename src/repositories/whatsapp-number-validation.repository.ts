import type {
  WhatsAppNumberValidation,
  WhatsAppNumberValidationScope,
  WhatsAppNumberValidationStatus,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface WhatsAppNumberValidationProgress {
  processed: number
  withWhatsapp: number
  withoutWhatsapp: number
  failed: number
  cached: number
}

export const WhatsAppNumberValidationRepository = {
  async create(data: {
    workspaceId: string
    connectionId: string
    requestedById: string | null
    scope: WhatsAppNumberValidationScope
    scopeId: string | null
    contactIds: string[]
    force: boolean
  }): Promise<Result<WhatsAppNumberValidation>> {
    try {
      const run = await prisma.whatsAppNumberValidation.create({
        data: { ...data, total: data.contactIds.length },
      })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to create whatsapp number validation', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppNumberValidation | null>> {
    try {
      const run = await prisma.whatsAppNumberValidation.findFirst({
        where: { id, workspaceId },
      })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to find whatsapp number validation', error))
    }
  },

  /** A run of the workspace still queued or running (one at a time). */
  async findActive(
    workspaceId: string,
  ): Promise<Result<WhatsAppNumberValidation | null>> {
    try {
      const run = await prisma.whatsAppNumberValidation.findFirst({
        where: { workspaceId, status: { in: ['QUEUED', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
      })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to find active whatsapp validation', error))
    }
  },

  /** System lookup for the worker (the id comes from our own job). */
  async findByIdRaw(
    id: string,
  ): Promise<Result<WhatsAppNumberValidation | null>> {
    try {
      const run = await prisma.whatsAppNumberValidation.findUnique({
        where: { id },
      })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to find whatsapp number validation', error))
    }
  },

  /** Moves QUEUED -> RUNNING; returns false when the run is not QUEUED
   * (already started or finished), so a retried job does not restart it. */
  async markRunning(id: string): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppNumberValidation.updateMany({
        where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'RUNNING', startedAt: new Date() },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to start whatsapp number validation', error))
    }
  },

  /** Adds the numbers of one finished chunk to the run counters. */
  async addProgress(
    id: string,
    delta: WhatsAppNumberValidationProgress,
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppNumberValidation.update({
        where: { id },
        data: {
          processed: { increment: delta.processed },
          withWhatsapp: { increment: delta.withWhatsapp },
          withoutWhatsapp: { increment: delta.withoutWhatsapp },
          failed: { increment: delta.failed },
          cached: { increment: delta.cached },
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to update whatsapp number validation', error))
    }
  },

  async finish(
    id: string,
    status: Extract<WhatsAppNumberValidationStatus, 'DONE' | 'FAILED'>,
    errorMessage: string | null,
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppNumberValidation.update({
        where: { id },
        data: { status, errorMessage, finishedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to finish whatsapp number validation', error))
    }
  },
}
