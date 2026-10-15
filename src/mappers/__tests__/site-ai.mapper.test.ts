import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { createFakeCrmFormDTO } from '@/src/__tests__/factories/crm-form.factory'
import {
  toSiteAiFormData,
  toSiteAiFormDTO,
  toSiteAiProductDTOs,
  toSiteAiTestimonial,
} from '../site-ai.mapper'

describe('toSiteAiProductDTOs', () => {
  it('formats prices in pt-BR and keeps the order', () => {
    expect(
      toSiteAiProductDTOs([
        {
          id: 'a',
          name: 'Pão',
          description: null,
          unitPrice: new Prisma.Decimal('18.5'),
          currency: 'BRL',
        },
        {
          id: 'b',
          name: 'Plano',
          description: 'Mensal',
          unitPrice: new Prisma.Decimal(10),
          currency: 'USD',
        },
      ]),
    ).toEqual([
      {
        id: 'a',
        name: 'Pão',
        description: '',
        price: expect.stringMatching(/^R\$\s18,50$/),
      },
      {
        id: 'b',
        name: 'Plano',
        description: 'Mensal',
        price: expect.stringContaining('10,00'),
      },
    ])
  })
})

describe('toSiteAiTestimonial', () => {
  it('reads quote, author and role from a landing-page section', () => {
    expect(
      toSiteAiTestimonial({
        type: 'TESTIMONIAL',
        quote: '  Excelente  ',
        authorName: 'Ana',
        authorRole: 'Cliente',
      }),
    ).toEqual({ quote: 'Excelente', name: 'Ana', role: 'Cliente' })
    expect(toSiteAiTestimonial({ quote: 'Bom', authorName: 'Rui' })).toEqual({
      quote: 'Bom',
      name: 'Rui',
      role: '',
    })
  })

  it('rejects content without quote or author', () => {
    expect(toSiteAiTestimonial(null)).toBeNull()
    expect(toSiteAiTestimonial('texto')).toBeNull()
    expect(toSiteAiTestimonial({ quote: 'x' })).toBeNull()
    expect(toSiteAiTestimonial({ authorName: 'x', quote: 5 })).toBeNull()
  })
})

describe('forms', () => {
  const form = createFakeCrmFormDTO({
    id: 'f1',
    name: 'Contato',
    publicToken: 'tok',
    fields: [
      {
        key: 'nome',
        label: 'Nome',
        type: 'text',
        required: true,
        placeholder: 'Seu nome',
        mapping: { target: 'lead', attribute: 'name' },
      },
      {
        key: 'assunto',
        label: 'Assunto',
        type: 'select',
        required: false,
        options: [{ label: 'Orçamento', value: 'orcamento' }],
        mapping: { target: 'lead', attribute: 'source' },
      },
      {
        key: 'obs',
        label: 'Obs',
        type: 'textarea',
        required: false,
        options: [],
        mapping: { target: 'lead', attribute: 'company' },
      },
    ],
  })

  it('lists a form by id, name and token', () => {
    expect(toSiteAiFormDTO(form)).toEqual({
      id: 'f1',
      name: 'Contato',
      publicToken: 'tok',
    })
  })

  it('snapshots the fields for the site.form node', () => {
    expect(toSiteAiFormData(form)).toEqual({
      formToken: 'tok',
      formName: 'Contato',
      fields: [
        {
          key: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          placeholder: 'Seu nome',
        },
        {
          key: 'assunto',
          label: 'Assunto',
          type: 'select',
          required: false,
          options: [{ label: 'Orçamento', value: 'orcamento' }],
        },
        { key: 'obs', label: 'Obs', type: 'textarea', required: false },
      ],
    })
  })
})
