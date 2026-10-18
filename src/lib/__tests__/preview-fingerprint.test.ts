import { describe, expect, it } from 'vitest'
import {
  previewFingerprint,
  samePreview,
} from '@/src/lib/ai/tools/preview-fingerprint'
import type { AiToolPreviewDTO } from '@/types/steel-ai'

const PREVIEW: AiToolPreviewDTO = {
  title: 'Atualizar chamado — INC-12',
  summary: 'Impressora parada',
  fields: [{ label: 'Prioridade', before: 'Baixa', after: 'Alta' }],
  target: {
    type: 'sd_ticket',
    id: 't1',
    label: 'INC-12',
    href: '/acme/servicedesk/tickets/12',
  },
}

describe('previewFingerprint()', () => {
  it('should ignore key order, extra keys and undefined vs null', () => {
    // The stored copy went through JSONB: keys reordered, undefined dropped.
    const stored = {
      target: {
        href: '/acme/servicedesk/tickets/12',
        label: 'INC-12',
        id: 't1',
        type: 'sd_ticket',
      },
      fields: [{ after: 'Alta', label: 'Prioridade', before: 'Baixa' }],
      summary: 'Impressora parada',
      title: 'Atualizar chamado — INC-12',
      extra: 'ignored',
    }
    expect(previewFingerprint(stored)).toBe(previewFingerprint(PREVIEW))
    expect(
      samePreview(
        { title: 'Criar tarefa', summary: 'x', fields: [{ label: 'A' }] },
        {
          title: 'Criar tarefa',
          summary: 'x',
          fields: [{ label: 'A', before: undefined, after: null }],
          target: undefined,
        },
      ),
    ).toBe(true)
  })

  it('should differ when a shown value changed', () => {
    expect(
      samePreview(PREVIEW, {
        ...PREVIEW,
        fields: [{ label: 'Prioridade', before: 'Média', after: 'Alta' }],
      }),
    ).toBe(false)
    expect(samePreview(PREVIEW, { ...PREVIEW, title: 'Outro' })).toBe(false)
    expect(samePreview(PREVIEW, { ...PREVIEW, summary: 'Outro' })).toBe(false)
    expect(
      samePreview(PREVIEW, {
        ...PREVIEW,
        target: { type: 'sd_ticket', id: 't2', label: 'INC-12' },
      }),
    ).toBe(false)
    expect(samePreview(PREVIEW, { ...PREVIEW, target: undefined })).toBe(false)
    expect(samePreview(PREVIEW, { ...PREVIEW, fields: [] })).toBe(false)
  })

  it('should keep field order significant', () => {
    const two: AiToolPreviewDTO = {
      title: 'T',
      summary: 'S',
      fields: [
        { label: 'A', after: '1' },
        { label: 'B', after: '2' },
      ],
    }
    expect(
      samePreview(two, { ...two, fields: [...(two.fields ?? [])].reverse() }),
    ).toBe(false)
  })

  it('should give malformed or legacy previews a stable value', () => {
    expect(previewFingerprint(null)).toBe(previewFingerprint(undefined))
    expect(previewFingerprint('texto')).toBe(previewFingerprint({}))
    expect(previewFingerprint({ title: 1, fields: 'x', target: null })).toBe(
      previewFingerprint({ title: '1' }),
    )
    expect(previewFingerprint({ fields: [null] })).toBe(
      previewFingerprint({ fields: [{}] }),
    )
    expect(samePreview(null, PREVIEW)).toBe(false)
  })
})
