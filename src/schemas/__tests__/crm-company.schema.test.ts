import { describe, expect, it } from 'vitest'
import {
  CreateCrmCompanySchema,
  ListCrmCompaniesSchema,
  ReorderCrmCompaniesSchema,
  UpdateCrmCompanySchema,
} from '../crm-company.schema'

describe('CreateCrmCompanySchema', () => {
  it('should accept minimal valid input and default icp to false', () => {
    const result = CreateCrmCompanySchema.safeParse({ name: 'Acme' })

    expect(result.success).toBe(true)
    expect(result.data?.icp).toBe(false)
  })

  it('should accept all optional fields', () => {
    const result = CreateCrmCompanySchema.safeParse({
      name: 'Acme',
      cnpj: '12345678000199',
      domain: 'acme.com',
      employees: 50,
      linkedin: 'https://linkedin.com/company/acme',
      address: { city: 'São Paulo', state: 'SP' },
      arr: 120000,
      icp: true,
      accountOwnerId: 'user_123',
    })

    expect(result.success).toBe(true)
  })

  it('should reject when name is missing', () => {
    const result = CreateCrmCompanySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should reject negative arr', () => {
    const result = CreateCrmCompanySchema.safeParse({
      name: 'Acme',
      arr: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe('UpdateCrmCompanySchema', () => {
  it('should accept a partial payload', () => {
    const result = UpdateCrmCompanySchema.safeParse({ name: 'New name' })
    expect(result.success).toBe(true)
  })

  it('should accept an empty payload', () => {
    const result = UpdateCrmCompanySchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('should leave icp undefined when omitted, not reset to its default', () => {
    const result = UpdateCrmCompanySchema.safeParse({ name: 'New name' })
    expect(result.data?.icp).toBeUndefined()
  })
})

describe('ListCrmCompaniesSchema', () => {
  it('should transform icp query param to boolean', () => {
    const result = ListCrmCompaniesSchema.safeParse({ icp: 'true' })
    expect(result.success).toBe(true)
    expect(result.data?.icp).toBe(true)
  })

  it('should leave icp undefined when omitted', () => {
    const result = ListCrmCompaniesSchema.safeParse({})
    expect(result.success).toBe(true)
    expect(result.data?.icp).toBeUndefined()
  })
})

describe('ReorderCrmCompaniesSchema', () => {
  it('should reject an empty orderedIds array', () => {
    const result = ReorderCrmCompaniesSchema.safeParse({ orderedIds: [] })
    expect(result.success).toBe(false)
  })

  it('should accept a non-empty orderedIds array', () => {
    const result = ReorderCrmCompaniesSchema.safeParse({
      orderedIds: ['a', 'b'],
    })
    expect(result.success).toBe(true)
  })
})

describe('UpdateCrmCompanySchema — clearing optional fields', () => {
  it.each(['cnpj', 'domain', 'linkedin', 'employees', 'arr', 'address'])(
    'should accept null to clear %s',
    (field) => {
      const result = UpdateCrmCompanySchema.safeParse({ [field]: null })
      expect(result.success).toBe(true)
      expect((result.data as Record<string, unknown>)[field]).toBeNull()
    },
  )

  it.each(['cnpj', 'domain', 'linkedin'])(
    'should normalize an emptied %s to null',
    (field) => {
      const result = UpdateCrmCompanySchema.safeParse({ [field]: '  ' })
      expect(result.success).toBe(true)
      expect((result.data as Record<string, unknown>)[field]).toBeNull()
    },
  )

  it('should leave omitted optional fields undefined', () => {
    const result = UpdateCrmCompanySchema.safeParse({})
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('cnpj')
  })
})

describe('registry fields', () => {
  it('accepts a full registry payload on create', () => {
    const r = CreateCrmCompanySchema.safeParse({
      name: 'Acme',
      legalName: 'ACME LTDA',
      tradeName: 'Acme',
      emails: ['a@acme.com'],
      phones: ['(11) 2395-8400'],
      cnaeCode: '4711302',
      cnaeDescription: 'Comércio',
      size: 'EPP',
      legalNature: 'Ltda',
      registrationStatus: 'ATIVA',
      openedAt: '2015-03-02',
      shareCapital: 0,
    })
    expect(r.success).toBe(true)
  })

  it.each([
    ['emails', ['nao-e-email']],
    ['emails', Array.from({ length: 21 }, (_, i) => `a${i}@x.com`)],
    ['phones', Array.from({ length: 21 }, () => '1')],
    ['size', 'GRANDE'],
    ['openedAt', '02/03/2015'],
    ['openedAt', '2015-13-45'],
    ['shareCapital', -1],
    ['cnaeCode', '12345678901'],
    ['legalName', 'x'.repeat(201)],
  ])('rejects invalid %s on create', (field, value) => {
    expect(
      CreateCrmCompanySchema.safeParse({ name: 'A', [field]: value }).success,
    ).toBe(false)
  })

  it('lets update clear registry fields with null or empty string', () => {
    const r = UpdateCrmCompanySchema.safeParse({
      legalName: '',
      tradeName: null,
      cnaeCode: null,
      size: null,
      openedAt: '',
      shareCapital: null,
    })
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({
      legalName: null,
      openedAt: null,
      size: null,
    })
  })

  it('rejects invalid values on update', () => {
    expect(UpdateCrmCompanySchema.safeParse({ emails: ['x'] }).success).toBe(
      false,
    )
    expect(
      UpdateCrmCompanySchema.safeParse({ openedAt: 'ontem' }).success,
    ).toBe(false)
  })
})
