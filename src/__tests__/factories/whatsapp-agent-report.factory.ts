import type { WhatsAppAgentReportSettings } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

/** WhatsApp agent report (ADR 0062): fakes (unit) and seeds (integration). */

export function createFakeWhatsAppAgentReportSettings(
  overrides?: Partial<WhatsAppAgentReportSettings>,
): WhatsAppAgentReportSettings {
  return {
    workspaceId: 'ws1',
    enabled: true,
    updatedById: null,
    createdAt: new Date('2026-11-06T10:00:00.000Z'),
    updatedAt: new Date('2026-11-06T10:00:00.000Z'),
    ...overrides,
  }
}

export async function seedWhatsAppAgentReportSettings(
  workspaceId: string,
  overrides?: Partial<WhatsAppAgentReportSettings>,
): Promise<WhatsAppAgentReportSettings> {
  return prisma.whatsAppAgentReportSettings.create({
    data: { workspaceId, enabled: true, ...overrides },
  })
}
