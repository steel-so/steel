import { describe, expect, it } from 'vitest'
import { CRM_IMPORT_MAX_ROWS, CrmImportSchema } from '../crm-import.schema'

const valid = {
  entity: 'leads',
  rows: [{ name: 'Ana', email: 'ana@x.com' }],
  consentConfirmed: true,
}

describe('CrmImportSchema', () => {
  it('accepts a valid body and trims cells', () => {
    const parsed = CrmImportSchema.parse({
      ...valid,
      rows: [{ name: '  Ana  ' }],
    })
    expect(parsed.rows[0].name).toBe('Ana')
  })

  it('rejects an unknown entity', () => {
    const result = CrmImportSchema.safeParse({ ...valid, entity: 'deals' })
    expect(result.success).toBe(false)
  })

  it('requires the consent statement', () => {
    const result = CrmImportSchema.safeParse({
      ...valid,
      consentConfirmed: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty file', () => {
    const result = CrmImportSchema.safeParse({ ...valid, rows: [] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('O arquivo não tem linhas')
  })

  it('rejects more rows than the cap', () => {
    const result = CrmImportSchema.safeParse({
      ...valid,
      rows: Array.from({ length: CRM_IMPORT_MAX_ROWS + 1 }, () => ({
        name: 'x',
      })),
    })
    expect(result.success).toBe(false)
  })

  it('rejects a cell over its limit', () => {
    const result = CrmImportSchema.safeParse({
      ...valid,
      rows: [{ name: 'a'.repeat(201) }],
    })
    expect(result.success).toBe(false)
  })
})
