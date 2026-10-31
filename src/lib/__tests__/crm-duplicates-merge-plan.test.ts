import { describe, expect, it } from 'vitest'
import {
  type CompanyFields,
  type PersonFields,
  planCompanyMerge,
  planPersonMerge,
} from '../crm-duplicates/merge-plan'

const person = (over: Partial<PersonFields> = {}): PersonFields => ({
  name: 'Ana',
  emails: [],
  phones: [],
  city: null,
  jobTitle: null,
  linkedin: null,
  avatar: null,
  companyId: null,
  ...over,
})

const company = (over: Partial<CompanyFields> = {}): CompanyFields => ({
  name: 'Acme',
  cnpj: null,
  domain: null,
  employees: null,
  linkedin: null,
  address: null,
  arr: null,
  icp: false,
  accountOwnerId: null,
  ...over,
})

describe('planPersonMerge', () => {
  it('unites e-mails and phones without repeating', () => {
    const plan = planPersonMerge(
      person({ emails: ['a@x.com'], phones: ['(11) 98765-4321'] }),
      person({
        emails: ['A@x.com', 'b@x.com'],
        phones: ['+55 11 98765 4321', '21 91234-5678'],
      }),
    )
    expect(plan.after.emails).toEqual(['a@x.com', 'b@x.com'])
    expect(plan.after.phones).toEqual(['(11) 98765-4321', '21 91234-5678'])
    expect(plan.before.emails).toEqual(['a@x.com'])
  })

  it('fills only the empty fields of the survivor', () => {
    const plan = planPersonMerge(
      person({ city: 'Recife' }),
      person({ city: 'Natal', jobTitle: 'CTO', companyId: 'c1' }),
    )
    expect(plan.after).toEqual({ jobTitle: 'CTO', companyId: 'c1' })
    expect(plan.before).toEqual({ jobTitle: null, companyId: null })
  })

  it('writes nothing when there is nothing to add', () => {
    const plan = planPersonMerge(
      person({ emails: ['a@x.com'] }),
      person({ emails: ['a@x.com'] }),
    )
    expect(plan).toEqual({ after: {}, before: {} })
  })
})

describe('planCompanyMerge', () => {
  it('takes the missing identifiers and the ICP flag', () => {
    const plan = planCompanyMerge(
      company({ domain: 'acme.com' }),
      company({
        cnpj: '12345678000195',
        domain: 'other.com',
        employees: 10,
        icp: true,
      }),
    )
    expect(plan.after).toEqual({
      cnpj: '12345678000195',
      employees: 10,
      icp: true,
    })
    expect(plan.before).toEqual({ cnpj: null, employees: null, icp: false })
  })

  it('treats blank strings as empty', () => {
    const plan = planCompanyMerge(
      company({ linkedin: '  ' }),
      company({ linkedin: 'in/acme' }),
    )
    expect(plan.after).toEqual({ linkedin: 'in/acme' })
  })
})
