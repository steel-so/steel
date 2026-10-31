import { describe, expect, it } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  createFakeDuplicateCandidate,
  createFakeMergeLog,
} from '@/src/__tests__/factories/nov-crm-ops.factory'
import {
  companyToDuplicateRecord,
  personToDuplicateRecord,
  toCrmDuplicateDTO,
  toCrmMergeDTO,
} from '../crm-duplicate.mapper'

describe('crm-duplicate mapper', () => {
  it('maps a person with its company name and history count', () => {
    const record = personToDuplicateRecord(
      {
        ...createFakeCrmPerson({
          name: 'Ana',
          emails: ['a@x.com'],
          jobTitle: 'CTO',
        }),
        company: { id: 'c1', name: 'Acme' },
      },
      4,
    )
    expect(record).toMatchObject({
      name: 'Ana',
      emails: ['a@x.com'],
      companyName: 'Acme',
      jobTitle: 'CTO',
      cnpj: null,
      historyCount: 4,
    })
    expect(
      personToDuplicateRecord({ ...createFakeCrmPerson(), company: null }, 0)
        .companyName,
    ).toBeNull()
  })

  it('maps a company', () => {
    const record = companyToDuplicateRecord(
      createFakeCrmCompany({
        name: 'Acme',
        cnpj: '12345678000195',
        domain: 'acme.com',
        employees: 12,
      }),
      2,
    )
    expect(record).toMatchObject({
      cnpj: '12345678000195',
      domain: 'acme.com',
      employees: 12,
      historyCount: 2,
    })
  })

  it('maps a candidate', () => {
    const left = personToDuplicateRecord(
      { ...createFakeCrmPerson(), company: null },
      0,
    )
    const right = personToDuplicateRecord(
      { ...createFakeCrmPerson(), company: null },
      1,
    )
    const dto = toCrmDuplicateDTO(
      createFakeDuplicateCandidate({ reasons: ['email', 'name'], score: 99 }),
      left,
      right,
    )
    expect(dto).toMatchObject({
      score: 99,
      reasons: ['email', 'name'],
      status: 'PENDING',
      left,
      right,
    })
  })

  it('maps a merge and tells whether it can still be undone', () => {
    const log = createFakeMergeLog()
    const open = toCrmMergeDTO(log, new Date('2026-10-30T13:00:00Z'))
    expect(open).toMatchObject({
      survivorName: 'Ana Souza',
      mergedName: 'Ana S.',
      canUndo: true,
      undoneAt: null,
    })
    expect(toCrmMergeDTO(log, new Date('2026-11-02T13:00:00Z')).canUndo).toBe(
      false,
    )
    const undone = toCrmMergeDTO(
      createFakeMergeLog({ undoneAt: new Date('2026-10-30T12:30:00Z') }),
      new Date('2026-10-30T13:00:00Z'),
    )
    expect(undone.canUndo).toBe(false)
    expect(undone.undoneAt).toBe('2026-10-30T12:30:00.000Z')
  })

  it('tolerates a log without a name snapshot', () => {
    const dto = toCrmMergeDTO(createFakeMergeLog({ snapshot: null as never }))
    expect(dto.survivorName).toBe('')
    expect(dto.mergedName).toBe('')
  })
})
