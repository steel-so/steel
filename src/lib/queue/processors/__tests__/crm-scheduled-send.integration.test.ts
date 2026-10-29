import type { Job } from 'bullmq'
import { describe, expect, it } from 'vitest'
import {
  seedCrmEmailCampaign,
  seedCrmEmailCampaignRecipient,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { seedWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { prisma } from '@/src/lib/prisma'
import { CrmScheduledSendJob } from '../../jobs'
import { processCrmScheduledSend } from '../crm-scheduled-send'

function tickJob(): Job {
  return {
    name: CrmScheduledSendJob.RunTick,
    id: 'test-tick',
  } as unknown as Job
}

describe('processCrmScheduledSend()', () => {
  it('should send due SCHEDULED campaigns and leave future ones alone', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    await seedMembership({ userId: user.id, workspaceId: workspace.id })
    // O envio passa pelo service, que exige o módulo CRM habilitado.
    await seedWorkspaceModuleAccess(workspace.id, user.id, { module: 'CRM' })
    const due = await seedCrmEmailCampaign(workspace.id, user.id, {
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
      // Platform address: sends without a verified domain (ADR 0055).
      fromAddress: 'notificacoes@stratustelecom.com.br',
    })
    await seedCrmEmailCampaignRecipient(due.id, { email: 'jane@example.com' })

    const future = await seedCrmEmailCampaign(workspace.id, user.id, {
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 60_000),
    })

    const result = await processCrmScheduledSend(tickJob())

    expect(result.due).toBe(1)
    expect(result.sent).toBe(1)
    expect(result.failed).toBe(0)

    const [dueAfter, futureAfter] = await Promise.all([
      prisma.crmEmailCampaign.findUniqueOrThrow({ where: { id: due.id } }),
      prisma.crmEmailCampaign.findUniqueOrThrow({ where: { id: future.id } }),
    ])
    expect(dueAfter.status).toBe('SENT')
    expect(futureAfter.status).toBe('SCHEDULED')
  })

  it('should fail a due campaign with no recipients instead of fanning out or retrying forever', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    await seedMembership({ userId: user.id, workspaceId: workspace.id })
    await seedWorkspaceModuleAccess(workspace.id, user.id, { module: 'CRM' })
    await prisma.crmPerson.create({
      data: {
        name: 'Não selecionada',
        emails: ['nao-selecionada@example.com'],
        workspaceId: workspace.id,
        createdById: user.id,
      },
    })
    const empty = await seedCrmEmailCampaign(workspace.id, user.id, {
      status: 'SCHEDULED',
      recipientScope: 'SELECTED',
      fromAddress: 'notificacoes@stratustelecom.com.br',
      scheduledAt: new Date(Date.now() - 60_000),
    })

    const result = await processCrmScheduledSend(tickJob())

    expect(result.due).toBe(1)
    expect(result.sent).toBe(0)
    expect(result.failed).toBe(1)

    const after = await prisma.crmEmailCampaign.findUniqueOrThrow({
      where: { id: empty.id },
    })
    expect(after.status).toBe('FAILED')
    expect(
      await prisma.crmEmailCampaignRecipient.count({
        where: { campaignId: empty.id },
      }),
    ).toBe(0)
  })

  it('should fail a due campaign whose From is not on a verified domain', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    await seedMembership({ userId: user.id, workspaceId: workspace.id })
    await seedWorkspaceModuleAccess(workspace.id, user.id, { module: 'CRM' })
    const blocked = await seedCrmEmailCampaign(workspace.id, user.id, {
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
      fromAddress: 'marketing@unverified-acme.com',
    })
    await seedCrmEmailCampaignRecipient(blocked.id, {
      email: 'jane@example.com',
    })

    const result = await processCrmScheduledSend(tickJob())

    expect(result).toEqual({ due: 1, sent: 0, failed: 1 })
    const after = await prisma.crmEmailCampaign.findUniqueOrThrow({
      where: { id: blocked.id },
    })
    expect(after.status).toBe('FAILED')
    const recipient = await prisma.crmEmailCampaignRecipient.findFirstOrThrow({
      where: { campaignId: blocked.id },
    })
    expect(recipient.status).toBe('PENDING')
  })
})
