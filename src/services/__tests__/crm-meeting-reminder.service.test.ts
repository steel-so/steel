import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeMeetingBooking,
  createFakeMeetingPage,
} from '@/src/__tests__/factories/nov-crm-ops.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-meeting.repository')
vi.mock('@/lib/axiom/logger')
vi.mock('../crm-meeting-public.service', () => ({
  sendMeetingReminder: vi.fn(),
}))

import { CrmMeetingRepository } from '@/src/repositories/crm-meeting.repository'
import { sendMeetingReminder } from '../crm-meeting-public.service'
import { CrmMeetingReminderService } from '../crm-meeting-reminder.service'

const repo = vi.mocked(CrmMeetingRepository)
const send = vi.mocked(sendMeetingReminder)

const due = (id: string) => ({
  ...createFakeMeetingBooking({ id }),
  page: { ...createFakeMeetingPage(), workspace: { name: 'Acme' } },
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('tick()', () => {
  it('should mail every claimed booking and count the deliveries', async () => {
    repo.dueReminders.mockResolvedValue(ok([due('a'), due('b'), due('c')]))
    repo.claimReminder
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    send.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const now = new Date('2026-11-09T12:00:00Z')

    const tick = expectOk(await CrmMeetingReminderService.tick(now))

    expect(tick).toEqual({ due: 3, sent: 1 })
    expect(repo.dueReminders).toHaveBeenCalledWith(now, 100)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('should use the current time by default and do nothing when idle', async () => {
    repo.dueReminders.mockResolvedValue(ok([]))

    expect(expectOk(await CrmMeetingReminderService.tick())).toEqual({
      due: 0,
      sent: 0,
    })
    expect(repo.claimReminder).not.toHaveBeenCalled()
  })

  it('should propagate a repository error', async () => {
    repo.dueReminders.mockResolvedValue(err(databaseError('x')))

    expectErr(await CrmMeetingReminderService.tick(), 'DATABASE_ERROR')
  })
})
