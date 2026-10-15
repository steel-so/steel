import { describe, expect, it } from 'vitest'
import {
  createFakeCrmEmailSavedBlock,
  createFakeCrmEmailTemplateVersion,
  createFakeCrmEmailTemplateVersionListItem,
} from '@/src/__tests__/factories/crm-email-editor.factory'
import {
  toCrmEmailSavedBlockDTO,
  toCrmEmailTemplateVersionDetailDTO,
  toCrmEmailTemplateVersionDTO,
} from '../crm-email-editor.mapper'

describe('crm-email-editor mapper', () => {
  it('maps a saved block with ISO dates and its kind', () => {
    const block = createFakeCrmEmailSavedBlock({ kind: 'section' })
    const dto = toCrmEmailSavedBlockDTO(block)
    expect(dto).toMatchObject({
      id: block.id,
      kind: 'section',
      nodeCount: 1,
      thumbnail: null,
      createdBy: { id: 'u1', name: 'Ana' },
      createdAt: '2026-10-14T12:00:00.000Z',
      updatedAt: '2026-10-14T12:00:00.000Z',
    })
    expect(dto.fragment).toBe(block.fragment)
    // Anything that is not a section is a block.
    expect(
      toCrmEmailSavedBlockDTO(createFakeCrmEmailSavedBlock({ kind: 'weird' }))
        .kind,
    ).toBe('block')
  })

  it('maps versions without and with the document', () => {
    const item = createFakeCrmEmailTemplateVersionListItem({
      reason: 'CAMPAIGN',
      createdBy: null,
    })
    expect(toCrmEmailTemplateVersionDTO(item)).toEqual({
      id: item.id,
      templateId: 't1',
      reason: 'CAMPAIGN',
      label: null,
      subject: 'Novidades',
      restoredFromId: null,
      createdBy: null,
      createdAt: '2026-10-14T12:00:00.000Z',
    })
    const version = createFakeCrmEmailTemplateVersion({
      document: { catalog: 'email' },
    })
    const detail = toCrmEmailTemplateVersionDetailDTO(version)
    expect(detail.document).toEqual({ catalog: 'email' })
    expect(detail).not.toHaveProperty('contentHash')
  })
})
