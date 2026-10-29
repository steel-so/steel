import { describe, expect, it } from 'vitest'
import {
  EnrichCompanySchema,
  ListCnpjRunsSchema,
  LookupCnpjSchema,
  StartCnpjRunSchema,
} from '../crm-cnpj.schema'

describe('crm-cnpj schemas', () => {
  it('requires a CNPJ to look up', () => {
    expect(LookupCnpjSchema.safeParse({ cnpj: '' }).success).toBe(false)
    expect(LookupCnpjSchema.safeParse({ cnpj: 'x'.repeat(31) }).success).toBe(
      false,
    )
    expect(LookupCnpjSchema.parse({ cnpj: '11.222.333/0001-81' }).cnpj).toBe(
      '11.222.333/0001-81',
    )
  })

  it('defaults overwrite to false when enriching one company', () => {
    expect(EnrichCompanySchema.parse({})).toEqual({ overwrite: false })
    expect(EnrichCompanySchema.parse({ overwrite: true })).toEqual({
      overwrite: true,
    })
  })

  it('defaults a bulk run to only-missing, no overwrite', () => {
    expect(StartCnpjRunSchema.parse({})).toEqual({
      onlyMissing: true,
      overwrite: false,
    })
    expect(
      StartCnpjRunSchema.parse({ onlyMissing: false, overwrite: true }),
    ).toEqual({ onlyMissing: false, overwrite: true })
  })

  it('coerces and bounds the run list limit', () => {
    expect(ListCnpjRunsSchema.parse({}).limit).toBe(10)
    expect(ListCnpjRunsSchema.parse({ limit: '5' }).limit).toBe(5)
    expect(ListCnpjRunsSchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(ListCnpjRunsSchema.safeParse({ limit: '51' }).success).toBe(false)
  })
})
