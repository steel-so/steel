import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppBroadcastRepository } from '../whatsapp-broadcast.repository'

let counter = 0
function suffix() {
  counter += 1
  return counter
}

async function seedFixtures() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Principal',
      phoneNumber: `55119999${suffix()}`,
      metaPhoneNumberId: `phone-${suffix()}`,
      metaWabaId: `waba-${suffix()}`,
      encryptedMetaAccessToken: 'enc:token',
      createdById: user.id,
    },
  })
  const template = await prisma.whatsAppTemplate.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      name: `lembrete-${suffix()}`,
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Olá {{1}}, seu horário é {{2}}' }],
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: `5511988887${suffix()}` },
  })
  return { workspace, user, connection, template, contact }
}

describe('WhatsAppBroadcastRepository', () => {
  describe('createScheduled()', () => {
    it('should create a QUEUED list with per-recipient variables and scheduledAt', async () => {
      const { workspace, connection, template, contact, user } =
        await seedFixtures()
      const scheduledAt = new Date('2026-08-14T09:00:00.000Z')

      const created = expectOk(
        await WhatsAppBroadcastRepository.createScheduled(
          {
            workspaceId: workspace.id,
            connectionId: connection.id,
            templateId: template.id,
            name: 'Lembrete de consulta',
            messageBody: template.name,
            createdById: user.id,
          },
          [
            {
              contactId: contact.id,
              variableValues: { body: { '1': 'Maria', '2': '15/08 às 09h' } },
              scheduledAt,
              appointmentAt: new Date('2026-08-15T09:00:00.000Z'),
            },
          ],
        ),
      )

      expect(created.status).toBe('QUEUED')
      expect(created.recipients).toHaveLength(1)
      expect(created.recipients[0].variableValues).toEqual({
        body: { '1': 'Maria', '2': '15/08 às 09h' },
      })
      expect(created.recipients[0].scheduledAt?.toISOString()).toBe(
        scheduledAt.toISOString(),
      )
    })
  })

  describe('listDueScheduledRecipients()', () => {
    it('should return only PENDING recipients past their scheduledAt in a QUEUED list', async () => {
      const { workspace, connection, template, contact, user } =
        await seedFixtures()
      const past = new Date(Date.now() - 60_000)
      const future = new Date(Date.now() + 60 * 60_000)

      const list = expectOk(
        await WhatsAppBroadcastRepository.createScheduled(
          {
            workspaceId: workspace.id,
            connectionId: connection.id,
            templateId: template.id,
            name: 'Lembretes',
            messageBody: template.name,
            createdById: user.id,
          },
          [
            {
              contactId: contact.id,
              variableValues: { body: { '1': 'Maria', '2': 'agora' } },
              scheduledAt: past,
              appointmentAt: future,
            },
          ],
        ),
      )

      // segundo contato, agendado no futuro — não deve aparecer no tick
      const futureContact = await prisma.whatsAppContact.create({
        data: { workspaceId: workspace.id, waId: `5511977776${suffix()}` },
      })
      await prisma.whatsAppBroadcastRecipient.create({
        data: {
          broadcastListId: list.id,
          contactId: futureContact.id,
          variableValues: { body: { '1': 'João', '2': 'depois' } },
          scheduledAt: future,
        },
      })

      const due = expectOk(
        await WhatsAppBroadcastRepository.listDueScheduledRecipients(
          new Date(),
        ),
      )

      expect(due).toHaveLength(1)
      expect(due[0].contact.waId).toBe(contact.waId)
      expect(due[0].broadcastList.id).toBe(list.id)
    })

    it('should not return recipients from a DRAFT (non-QUEUED) list', async () => {
      const { workspace, connection, template, contact, user } =
        await seedFixtures()
      const list = await prisma.whatsAppBroadcastList.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          templateId: template.id,
          name: 'Rascunho',
          messageBody: template.name,
          status: 'DRAFT',
          createdById: user.id,
        },
      })
      await prisma.whatsAppBroadcastRecipient.create({
        data: {
          broadcastListId: list.id,
          contactId: contact.id,
          scheduledAt: new Date(Date.now() - 60_000),
        },
      })

      const due = expectOk(
        await WhatsAppBroadcastRepository.listDueScheduledRecipients(
          new Date(),
        ),
      )

      expect(due).toEqual([])
    })
  })

  describe('findUpcomingAppointmentByContact()', () => {
    it('should return the soonest future appointment for the contact', async () => {
      const { workspace, connection, template, contact, user } =
        await seedFixtures()
      const list = await prisma.whatsAppBroadcastList.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          templateId: template.id,
          name: 'Confirmação de exames',
          messageBody: template.name,
          status: 'QUEUED',
          createdById: user.id,
        },
      })
      const soon = new Date(Date.now() + 24 * 60 * 60_000)
      const later = new Date(Date.now() + 72 * 60 * 60_000)
      await prisma.whatsAppBroadcastRecipient.createMany({
        data: [
          {
            broadcastListId: list.id,
            contactId: contact.id,
            appointmentAt: later,
          },
        ],
      })
      const secondList = await prisma.whatsAppBroadcastList.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          templateId: template.id,
          name: 'Confirmação de exames 2',
          messageBody: template.name,
          status: 'QUEUED',
          createdById: user.id,
        },
      })
      await prisma.whatsAppBroadcastRecipient.create({
        data: {
          broadcastListId: secondList.id,
          contactId: contact.id,
          appointmentAt: soon,
        },
      })

      const result = expectOk(
        await WhatsAppBroadcastRepository.findUpcomingAppointmentByContact(
          contact.id,
        ),
      )

      expect(result?.appointmentAt?.toISOString()).toBe(soon.toISOString())
      expect(result?.broadcastList.name).toBe('Confirmação de exames 2')
    })

    it('should ignore past appointments', async () => {
      const { workspace, connection, template, contact, user } =
        await seedFixtures()
      const list = await prisma.whatsAppBroadcastList.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          templateId: template.id,
          name: 'Confirmação de exames',
          messageBody: template.name,
          status: 'QUEUED',
          createdById: user.id,
        },
      })
      await prisma.whatsAppBroadcastRecipient.create({
        data: {
          broadcastListId: list.id,
          contactId: contact.id,
          appointmentAt: new Date(Date.now() - 60_000),
        },
      })

      const result = expectOk(
        await WhatsAppBroadcastRepository.findUpcomingAppointmentByContact(
          contact.id,
        ),
      )

      expect(result).toBeNull()
    })

    it('should return null when the contact has no appointment at all', async () => {
      const { contact } = await seedFixtures()

      const result = expectOk(
        await WhatsAppBroadcastRepository.findUpcomingAppointmentByContact(
          contact.id,
        ),
      )

      expect(result).toBeNull()
    })
  })

  describe('create() / listByWorkspace() / findById()', () => {
    it('should create a list with recipients and list it scoped to the workspace, newest first', async () => {
      const { workspace, connection, contact, user } = await seedFixtures()
      const other = await seedFixtures()

      const older = expectOk(
        await WhatsAppBroadcastRepository.create(
          {
            workspaceId: workspace.id,
            connectionId: connection.id,
            name: 'Antiga',
            messageBody: 'Oi',
            createdById: user.id,
          },
          [contact.id],
        ),
      )
      await prisma.whatsAppBroadcastList.update({
        where: { id: older.id },
        data: { createdAt: new Date('2020-01-01') },
      })
      const newer = expectOk(
        await WhatsAppBroadcastRepository.create(
          {
            workspaceId: workspace.id,
            connectionId: connection.id,
            name: 'Nova',
            messageBody: 'Oi',
            createdById: user.id,
          },
          [],
        ),
      )
      expectOk(
        await WhatsAppBroadcastRepository.create(
          {
            workspaceId: other.workspace.id,
            connectionId: other.connection.id,
            name: 'Outra',
            messageBody: 'Oi',
            createdById: other.user.id,
          },
          [other.contact.id],
        ),
      )

      expect(older.status).toBe('DRAFT')
      expect(older.recipients.map((r) => r.contact.id)).toEqual([contact.id])

      const lists = expectOk(
        await WhatsAppBroadcastRepository.listByWorkspace(workspace.id),
      )
      expect(lists.map((l) => l.id)).toEqual([newer.id, older.id])
      expect(lists[1].recipients).toEqual([{ status: 'PENDING' }])

      const found = expectOk(
        await WhatsAppBroadcastRepository.findById(older.id, workspace.id),
      )
      expect(found?.recipients[0].contact.waId).toBe(contact.waId)
      expect(
        expectOk(
          await WhatsAppBroadcastRepository.findById(
            older.id,
            other.workspace.id,
          ),
        ),
      ).toBeNull()

      expect(
        expectOk(await WhatsAppBroadcastRepository.findByIdRaw(older.id))?.name,
      ).toBe('Antiga')
      expect(
        expectOk(await WhatsAppBroadcastRepository.findByIdRaw('missing')),
      ).toBeNull()
    })

    it('should return DATABASE_ERROR when the connection does not exist', async () => {
      const { workspace, user } = await seedFixtures()
      const data = {
        workspaceId: workspace.id,
        connectionId: 'missing',
        name: 'X',
        messageBody: 'Oi',
        createdById: user.id,
      }
      expectErr(
        await WhatsAppBroadcastRepository.create(data, []),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.createScheduled(data, []),
        'DATABASE_ERROR',
      )
    })
  })

  describe('status and recipient updates', () => {
    async function seedListWithRecipients() {
      const fx = await seedFixtures()
      const second = await prisma.whatsAppContact.create({
        data: { workspaceId: fx.workspace.id, waId: `5511966665${suffix()}` },
      })
      const list = expectOk(
        await WhatsAppBroadcastRepository.create(
          {
            workspaceId: fx.workspace.id,
            connectionId: fx.connection.id,
            name: 'Campanha',
            messageBody: 'Oi',
            createdById: fx.user.id,
          },
          [fx.contact.id, second.id],
        ),
      )
      return { ...fx, list }
    }

    it('should update the list status', async () => {
      const { list } = await seedListWithRecipients()
      expectOk(
        await WhatsAppBroadcastRepository.updateStatus(list.id, 'RUNNING'),
      )
      const stored = await prisma.whatsAppBroadcastList.findUniqueOrThrow({
        where: { id: list.id },
      })
      expect(stored.status).toBe('RUNNING')
    })

    it('should list, find and update recipients and count pending/failed', async () => {
      const { list } = await seedListWithRecipients()
      const recipients = expectOk(
        await WhatsAppBroadcastRepository.listRecipients(list.id),
      )
      expect(recipients).toHaveLength(2)
      const [first, second] = recipients

      const found = expectOk(
        await WhatsAppBroadcastRepository.findRecipientById(first.id),
      )
      expect(found?.broadcastList.id).toBe(list.id)
      expect(
        expectOk(
          await WhatsAppBroadcastRepository.findRecipientById('missing'),
        ),
      ).toBeNull()

      expectOk(
        await WhatsAppBroadcastRepository.updateRecipientStatus(first.id, {
          status: 'SENT',
          providerMessageId: 'wamid.1',
          sentAt: new Date(),
        }),
      )
      expectOk(
        await WhatsAppBroadcastRepository.updateRecipientStatus(second.id, {
          status: 'FAILED',
          errorMessage: 'rejeitado',
        }),
      )

      const stored = await prisma.whatsAppBroadcastRecipient.findUniqueOrThrow({
        where: { id: first.id },
      })
      expect(stored.status).toBe('SENT')
      expect(stored.providerMessageId).toBe('wamid.1')
      expect(
        expectOk(
          await WhatsAppBroadcastRepository.countPendingRecipients(list.id),
        ),
      ).toBe(0)
      expect(
        expectOk(
          await WhatsAppBroadcastRepository.countFailedRecipients(list.id),
        ),
      ).toBe(1)
    })

    it('should tally recipients per status', async () => {
      const { list } = await seedListWithRecipients()
      const [first] = expectOk(
        await WhatsAppBroadcastRepository.listRecipients(list.id),
      )
      expectOk(
        await WhatsAppBroadcastRepository.updateRecipientStatus(first.id, {
          status: 'FAILED',
          errorMessage: 'x',
        }),
      )
      expect(
        expectOk(
          await WhatsAppBroadcastRepository.countRecipientsByStatus(list.id),
        ),
      ).toEqual({
        PENDING: 1,
        SENT: 0,
        FAILED: 1,
        SKIPPED: 0,
        SKIPPED_NO_WHATSAPP: 0,
      })
    })

    it('should close a sending list only once', async () => {
      const { list } = await seedListWithRecipients()
      expect(
        expectOk(
          await WhatsAppBroadcastRepository.closeIfRunning(list.id, 'DONE'),
        ),
      ).toBeNull()

      expectOk(
        await WhatsAppBroadcastRepository.updateStatus(list.id, 'RUNNING'),
      )
      const closed = expectOk(
        await WhatsAppBroadcastRepository.closeIfRunning(list.id, 'FAILED'),
      )
      expect(closed).toMatchObject({ id: list.id, status: 'FAILED' })
      expect(
        expectOk(
          await WhatsAppBroadcastRepository.closeIfRunning(list.id, 'DONE'),
        ),
      ).toBeNull()
    })

    it('should map thrown tally and close failures to DATABASE_ERROR', async () => {
      const group = vi
        .spyOn(prisma.whatsAppBroadcastRecipient, 'groupBy')
        .mockRejectedValueOnce(new Error('boom'))
      const close = vi
        .spyOn(prisma.whatsAppBroadcastList, 'updateManyAndReturn')
        .mockRejectedValueOnce(new Error('boom'))
      expectErr(
        await WhatsAppBroadcastRepository.countRecipientsByStatus('b'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.closeIfRunning('b', 'DONE'),
        'DATABASE_ERROR',
      )
      group.mockRestore()
      close.mockRestore()
    })

    it('should mark only PENDING recipients as SKIPPED', async () => {
      const { list } = await seedListWithRecipients()
      const [first, second] = expectOk(
        await WhatsAppBroadcastRepository.listRecipients(list.id),
      )
      await prisma.whatsAppBroadcastRecipient.update({
        where: { id: second.id },
        data: { status: 'SENT' },
      })

      expect(
        expectOk(
          await WhatsAppBroadcastRepository.markRecipientsSkipped([
            first.id,
            second.id,
          ]),
        ),
      ).toBe(1)
      const skipped = await prisma.whatsAppBroadcastRecipient.findUniqueOrThrow(
        { where: { id: first.id } },
      )
      expect(skipped.status).toBe('SKIPPED')
      expect(skipped.errorMessage).toMatch(/opt-out/)
    })

    it('should short-circuit markRecipientsSkipped() with no ids', async () => {
      const spy = vi.spyOn(prisma.whatsAppBroadcastRecipient, 'updateMany')
      expect(
        expectOk(await WhatsAppBroadcastRepository.markRecipientsSkipped([])),
      ).toBe(0)
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it('should return DATABASE_ERROR when updating missing rows', async () => {
      expectErr(
        await WhatsAppBroadcastRepository.updateStatus('missing', 'DONE'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.updateRecipientStatus('missing', {
          status: 'SENT',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('query failures', () => {
    it('should map thrown list lookups to DATABASE_ERROR', async () => {
      const list = prisma.whatsAppBroadcastList
      vi.spyOn(list, 'findMany').mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(list, 'findFirst').mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(list, 'findUnique').mockRejectedValueOnce(new Error('boom'))

      expectErr(
        await WhatsAppBroadcastRepository.listByWorkspace('w'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.findById('b', 'w'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.findByIdRaw('b'),
        'DATABASE_ERROR',
      )
    })

    it('should map thrown recipient queries to DATABASE_ERROR', async () => {
      const recipient = prisma.whatsAppBroadcastRecipient
      vi.spyOn(recipient, 'findMany')
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(recipient, 'findUnique').mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(recipient, 'findFirst').mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(recipient, 'updateMany').mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(recipient, 'count')
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))

      expectErr(
        await WhatsAppBroadcastRepository.listDueScheduledRecipients(
          new Date(),
        ),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.listRecipients('b'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.findRecipientById('r'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.findUpcomingAppointmentByContact('c'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.markRecipientsSkipped(['r']),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.countPendingRecipients('b'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppBroadcastRepository.countFailedRecipients('b'),
        'DATABASE_ERROR',
      )
    })
  })
})
