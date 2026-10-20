import type { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  autoOutreachTemplateProblem,
  autoOutreachVariableValue,
  buildAutoOutreachTemplate,
} from '@/src/lib/whatsapp/auto-outreach'

const meta = { provider: 'META' as const, module: 'COMMUNICATION' as const }
const approved = (components: Prisma.JsonArray) => ({
  status: 'APPROVED' as const,
  components,
})

describe('autoOutreachTemplateProblem()', () => {
  it('should accept an approved Meta template with text variables', () => {
    expect(
      autoOutreachTemplateProblem(
        meta,
        approved([{ type: 'BODY', text: 'Olá {{1}}!' }]),
      ),
    ).toBeNull()
  })

  it('should refuse a Z-API or ServiceDesk connection', () => {
    const template = approved([{ type: 'BODY', text: 'Oi' }])
    expect(
      autoOutreachTemplateProblem(
        { provider: 'ZAPI', module: 'COMMUNICATION' },
        template,
      ),
    ).toContain('Meta')
    expect(
      autoOutreachTemplateProblem(
        { provider: 'META', module: 'SERVICE_DESK' },
        template,
      ),
    ).toContain('Meta')
  })

  it('should refuse a template not approved', () => {
    expect(
      autoOutreachTemplateProblem(meta, {
        status: 'PENDING',
        components: [{ type: 'BODY', text: 'Oi' }],
      }),
    ).toContain('aprovado')
  })

  it('should refuse a dynamic URL button', () => {
    expect(
      autoOutreachTemplateProblem(
        meta,
        approved([
          { type: 'BODY', text: 'Oi' },
          {
            type: 'BUTTONS',
            buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.com/{{1}}' }],
          },
        ]),
      ),
    ).toContain('link dinâmico')
  })
})

describe('buildAutoOutreachTemplate()', () => {
  it('should fill every text variable with the first name', () => {
    const built = buildAutoOutreachTemplate(
      {
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Oi {{1}}' },
          { type: 'BODY', text: '{{1}}, temos uma oferta. {{2}}' },
        ],
      },
      'Maria Souza',
    )

    expect(built.text).toBe('Maria, temos uma oferta. Maria')
    expect(built.components).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Maria' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maria' },
          { type: 'text', text: 'Maria' },
        ],
      },
    ])
  })

  it('should send no parameters for a template without variables', () => {
    const built = buildAutoOutreachTemplate(
      { components: [{ type: 'BODY', text: 'Bem-vindo!' }] },
      null,
    )
    expect(built).toEqual({ components: [], text: 'Bem-vindo!' })
  })

  it('should fall back to "cliente" without a name', () => {
    expect(autoOutreachVariableValue(null)).toBe('cliente')
    expect(autoOutreachVariableValue('   ')).toBe('cliente')
  })
})
