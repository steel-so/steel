import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-cadence.repository')
vi.mock('@/lib/axiom/logger')

import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceRepository,
} from '@/src/repositories/crm-cadence.repository'
import { CrmCadenceReplyService } from '../crm-cadence-reply.service'

const cadences = vi.mocked(CrmCadenceRepository)
const enrollments = vi.mocked(CrmCadenceEnrollmentRepository)
const now = new Date('2026-10-29T12:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('onWhatsAppReply()', () => {
  it('should end the matching enrollments as replied via WhatsApp', async () => {
    cadences.stopOnReplyEnrollmentIdsByPhone.mockResolvedValue(ok(['e1', 'e2']))
    enrollments.finish.mockResolvedValue(ok(2))

    expect(
      await CrmCadenceReplyService.onWhatsAppReply(
        'ws1',
        '+55 11 99999-0000',
        now,
      ),
    ).toBe(2)
    expect(cadences.stopOnReplyEnrollmentIdsByPhone).toHaveBeenCalledWith(
      'ws1',
      '5511999990000',
    )
    expect(enrollments.finish).toHaveBeenCalledWith(
      ['e1', 'e2'],
      'REPLIED',
      'REPLIED',
      'WHATSAPP',
      now,
    )
  })

  it('should return 0 without failing when the lookup or the update fails', async () => {
    cadences.stopOnReplyEnrollmentIdsByPhone.mockResolvedValueOnce(
      err(databaseError()),
    )
    expect(
      await CrmCadenceReplyService.onWhatsAppReply('ws1', '5511999990000'),
    ).toBe(0)

    cadences.stopOnReplyEnrollmentIdsByPhone.mockResolvedValue(ok(['e1']))
    enrollments.finish.mockResolvedValueOnce(err(databaseError()))
    expect(
      await CrmCadenceReplyService.onWhatsAppReply('ws1', '5511999990000'),
    ).toBe(0)
  })

  it('should swallow unexpected exceptions', async () => {
    cadences.stopOnReplyEnrollmentIdsByPhone.mockRejectedValue(
      new Error('boom'),
    )
    expect(
      await CrmCadenceReplyService.onWhatsAppReply('ws1', '5511999990000'),
    ).toBe(0)
  })
})

describe('onEmailReply()', () => {
  it('should lower-case the address and end the enrollments', async () => {
    cadences.stopOnReplyEnrollmentIdsByEmail.mockResolvedValue(ok(['e1']))
    enrollments.finish.mockResolvedValue(ok(1))

    expect(
      await CrmCadenceReplyService.onEmailReply(
        'ws1',
        ' Ana@Empresa.com.br ',
        now,
      ),
    ).toBe(1)
    expect(cadences.stopOnReplyEnrollmentIdsByEmail).toHaveBeenCalledWith(
      'ws1',
      ['ana@empresa.com.br'],
    )
    expect(enrollments.finish).toHaveBeenCalledWith(
      ['e1'],
      'REPLIED',
      'REPLIED',
      'EMAIL',
      now,
    )
  })

  it('should ignore an empty address', async () => {
    expect(await CrmCadenceReplyService.onEmailReply('ws1', '  ')).toBe(0)
    expect(cadences.stopOnReplyEnrollmentIdsByEmail).not.toHaveBeenCalled()
  })

  it('should return 0 on failures', async () => {
    cadences.stopOnReplyEnrollmentIdsByEmail.mockResolvedValueOnce(
      err(databaseError()),
    )
    expect(await CrmCadenceReplyService.onEmailReply('ws1', 'a@b.com')).toBe(0)

    cadences.stopOnReplyEnrollmentIdsByEmail.mockResolvedValue(ok(['e1']))
    enrollments.finish.mockResolvedValueOnce(err(databaseError()))
    expect(await CrmCadenceReplyService.onEmailReply('ws1', 'a@b.com')).toBe(0)

    cadences.stopOnReplyEnrollmentIdsByEmail.mockRejectedValue(
      new Error('boom'),
    )
    expect(await CrmCadenceReplyService.onEmailReply('ws1', 'a@b.com')).toBe(0)
  })
})
