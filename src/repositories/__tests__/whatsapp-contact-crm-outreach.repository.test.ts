import { describe, expect, it } from 'vitest'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppContactRepository } from '../whatsapp-contact.repository'

describe('WhatsAppContactRepository.markCrmOutreach()', () => {
  it('creates the contact marked when the number is new', async () => {
    const workspace = await seedWorkspace()

    const contact = expectOk(
      await WhatsAppContactRepository.markCrmOutreach({
        workspaceId: workspace.id,
        waId: '5511999990001',
      }),
    )

    expect(contact.crmOutreachAt).toBeInstanceOf(Date)
  })

  it('marks an existing contact without renaming it', async () => {
    const workspace = await seedWorkspace()
    const existing = await prisma.whatsAppContact.create({
      data: {
        workspaceId: workspace.id,
        waId: '5511999990002',
        name: 'Nome original',
      },
    })

    const contact = expectOk(
      await WhatsAppContactRepository.markCrmOutreach({
        workspaceId: workspace.id,
        waId: '5511999990002',
      }),
    )

    expect(contact.id).toBe(existing.id)
    expect(contact.name).toBe('Nome original')
    expect(contact.crmOutreachAt).toBeInstanceOf(Date)
  })

  it('keeps the first timestamp on later sends', async () => {
    const workspace = await seedWorkspace()
    const first = expectOk(
      await WhatsAppContactRepository.markCrmOutreach({
        workspaceId: workspace.id,
        waId: '5511999990003',
      }),
    )

    const second = expectOk(
      await WhatsAppContactRepository.markCrmOutreach({
        workspaceId: workspace.id,
        waId: '5511999990003',
      }),
    )

    expect(second.crmOutreachAt).toEqual(first.crmOutreachAt)
  })
})
