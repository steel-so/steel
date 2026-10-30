import { describe, expect, it } from 'vitest'
import { CrmNlSearchSchema } from '../crm-nl-search.schema'

describe('CrmNlSearchSchema', () => {
  it('trims the question', () => {
    expect(
      CrmNlSearchSchema.parse({ query: '  negócios parados  ' }).query,
    ).toBe('negócios parados')
  })

  it.each(['', ' ', 'a', 'x'.repeat(301)])('rejects %j', (query) => {
    expect(CrmNlSearchSchema.safeParse({ query }).success).toBe(false)
  })
})

describe('entity filters share the question schema', () => {
  it('accepts the same trimmed question for leads, people and companies', () => {
    expect(CrmNlSearchSchema.parse({ query: ' leads quentes ' }).query).toBe(
      'leads quentes',
    )
  })
})
