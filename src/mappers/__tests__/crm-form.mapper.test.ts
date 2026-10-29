import { describe, expect, it } from 'vitest'
import {
  createFakeCrmForm,
  createFakeCrmFormSubmission,
} from '@/src/__tests__/factories/crm-form.factory'
import {
  toCrmFormDTO,
  toCrmFormPublicDTO,
  toCrmFormSubmissionDTO,
} from '../crm-form.mapper'

describe('toCrmFormDTO()', () => {
  it('should map all fields correctly', () => {
    const form = createFakeCrmForm({ id: 'f-1', name: 'Contato' })
    const dto = toCrmFormDTO(form)
    expect(dto.id).toBe('f-1')
    expect(dto.name).toBe('Contato')
  })
})

describe('toCrmFormPublicDTO()', () => {
  it('should omit internal fields', () => {
    const form = createFakeCrmForm({ id: 'f-1', publicToken: 'tok' })
    const dto = toCrmFormPublicDTO(form)
    expect(dto).not.toHaveProperty('publicToken')
    expect(dto.id).toBe('f-1')
  })
})

describe('toCrmFormSubmissionDTO()', () => {
  it('should map all fields correctly', () => {
    const submission = createFakeCrmFormSubmission({ id: 's-1' })
    const dto = toCrmFormSubmissionDTO(submission)
    expect(dto.id).toBe('s-1')
  })
})

describe('toCrmFormPublicDTO() — newsletter (ADR 0054)', () => {
  it('should carry the newsletter consent box when given', () => {
    const form = createFakeCrmForm({ newsletterId: 'nl1' })
    const newsletter = { name: 'Novidades', consentText: 'Quero receber' }
    expect(toCrmFormPublicDTO(form, newsletter).newsletter).toEqual(newsletter)
    expect(toCrmFormPublicDTO(form, null).newsletter).toBeNull()
    expect(toCrmFormPublicDTO(form)).not.toHaveProperty('newsletter')
    expect(toCrmFormDTO(form).newsletterId).toBe('nl1')
  })
})
