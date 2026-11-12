import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ok } from '@/src/lib/result'

vi.mock('pdf-parse/lib/pdf-parse.js', () => ({ default: vi.fn() }))
vi.mock('@/src/lib/whatsapp/knowledge-document', () => ({
  extractKnowledgeDocumentText: vi.fn(),
}))

import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import {
  acceptsPdfInput,
  documentImportFileName,
  documentImportKey,
  outlineMaxTokens,
} from '@/src/lib/document-ai/constants'
import {
  estimateDocumentAi,
  estimateDocumentImport,
  guessPages,
} from '@/src/lib/document-ai/estimate'
import {
  countPdfPages,
  extractDocxText,
  extractPdfPages,
  looksLikeDocx,
  looksLikePdf,
  pagesAsText,
} from '@/src/lib/document-ai/extract'
import {
  DOCUMENT_OUTLINE_JSON_SCHEMA,
  DocumentOutlineAnswerSchema,
  sanitizeInlineHtml,
  stripNulls,
  wireToOutlineInput,
} from '@/src/lib/document-ai/outline-wire'
import {
  failedProgress,
  parseProgress,
  progressOf,
  streamingProgress,
} from '@/src/lib/document-ai/progress'
import {
  boundText,
  buildImportSystem,
  buildPromptSystem,
  pdfImportContent,
  promptContent,
  textImportContent,
} from '@/src/lib/document-ai/prompts'
import { extractKnowledgeDocumentText } from '@/src/lib/whatsapp/knowledge-document'

const parse = vi.mocked(pdfParse)
const knowledgeText = vi.mocked(extractKnowledgeDocumentText)

// ─── outline wire ────────────────────────────────────────────────────────

const section = (blocks: unknown[], name = 'Seção') => ({
  name,
  variant: null,
  pageBreakBefore: null,
  blocks,
})

describe('DOCUMENT_OUTLINE_JSON_SCHEMA', () => {
  it('should be a closed, fully required object for strict mode', () => {
    const schema = DOCUMENT_OUTLINE_JSON_SCHEMA as {
      required: string[]
      additionalProperties: boolean
      $defs: { leaf: { anyOf: { required: string[]; properties: object }[] } }
    }
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual([
      'title',
      'kind',
      'primaryColor',
      'sections',
    ])
    for (const leaf of schema.$defs.leaf.anyOf) {
      expect(leaf.required).toEqual(Object.keys(leaf.properties))
    }
    expect(JSON.stringify(schema)).not.toMatch(/maxLength|minimum|maximum/)
  })
})

describe('stripNulls()', () => {
  it('should drop nulls deep in objects and arrays', () => {
    expect(stripNulls({ a: null, b: [{ c: null, d: 1 }], e: 'x' })).toEqual({
      b: [{ d: 1 }],
      e: 'x',
    })
  })
})

describe('sanitizeInlineHtml()', () => {
  it('should keep the allowed tags and safe links only', () => {
    expect(
      sanitizeInlineHtml(
        '<p class="x" onclick="y()">Olá <b>forte</b> <i>it</i><br/></p>' +
          '<script>alert(1)</script><a href="javascript:x">a</a>' +
          '<a href="https://steel.com" target="_blank">b</a><h2>T</h2><table>',
      ),
    ).toBe(
      '<p>Olá <strong>forte</strong> <em>it</em><br></p>' +
        '<a>a</a><a href="https://steel.com">b</a>T',
    )
  })
})

describe('wireToOutlineInput()', () => {
  it('should leave a non-object answer alone', () => {
    expect(wireToOutlineInput(null)).toBeNull()
    expect(wireToOutlineInput([1])).toEqual([1])
  })

  it('should normalize tables, pricing ids, columns and the color', () => {
    const input = wireToOutlineInput({
      title: 'Doc',
      kind: 'QUOTE',
      primaryColor: 'azul',
      sections: [
        section([
          {
            type: 'table',
            header: Array.from({ length: 14 }, (_, i) => `H${i}`),
            rows: [Array.from({ length: 13 }, () => 'c'), 'not a row'],
          },
          { type: 'table', header: null, rows: null },
          {
            type: 'pricing',
            items: [{ name: 'A' }, { name: 'B' }],
          },
          { type: 'columns', columns: [[{ type: 'divider' }]] },
          {
            type: 'columns',
            columns: [
              [{ type: 'text', html: '<b>a</b>' }],
              [{ type: 'divider' }],
              [],
              [],
              [],
            ],
          },
          { type: 'columns', columns: 'broken' },
          { type: 'text', html: null },
        ]),
      ],
    }) as {
      theme?: unknown
      primaryColor?: unknown
      sections: { blocks: Record<string, unknown>[] }[]
    }

    expect(input.theme).toBeUndefined()
    expect(input).not.toHaveProperty('primaryColor')
    const [table, empty, pricing, single, columns, ...rest] =
      input.sections[0].blocks
    expect((table.header as string[]).length).toBe(12)
    expect(table.rows).toEqual([Array.from({ length: 12 }, () => 'c'), []])
    expect(empty).toEqual({ type: 'table', rows: [] })
    expect(pricing.items).toEqual([
      { name: 'A', id: 'item-1' },
      { name: 'B', id: 'item-2' },
    ])
    expect(single).toEqual({ type: 'divider' })
    expect(columns.columns).toHaveLength(4)
    expect((columns.columns as unknown[][])[0]).toEqual([
      { type: 'text', html: '<strong>a</strong>' },
    ])
    expect(rest).toEqual([{ type: 'text', html: '' }])
  })

  it('should split long sections and cap the section count', () => {
    const blocks = Array.from({ length: 170 }, () => ({ type: 'divider' }))
    const input = wireToOutlineInput({
      title: 'Doc',
      kind: 'OTHER',
      primaryColor: '#ABCDEF',
      sections: [
        { ...section(blocks, 'Cláusulas'), variant: 'highlight' },
        ...Array.from({ length: 70 }, () => section([])),
      ],
    }) as {
      theme: unknown
      sections: { name: string; variant?: string; blocks: unknown[] }[]
    }

    expect(input.theme).toEqual({ primaryColor: '#ABCDEF' })
    expect(input.sections).toHaveLength(60)
    expect(input.sections.slice(0, 3).map((item) => item.name)).toEqual([
      'Cláusulas',
      'Cláusulas (continuação)',
      'Cláusulas (continuação)',
    ])
    expect(input.sections[0].variant).toBe('highlight')
    expect(input.sections[1].variant).toBe('default')
    expect(input.sections[2].blocks).toHaveLength(10)
  })
})

describe('DocumentOutlineAnswerSchema', () => {
  it('should accept a wire answer and reject an invalid one', () => {
    const parsed = DocumentOutlineAnswerSchema.safeParse({
      title: 'Termo de adesão',
      kind: 'TERMS',
      primaryColor: null,
      sections: [
        section([
          {
            type: 'field',
            fieldType: 'field-cpf',
            label: 'CPF',
            required: true,
            placeholder: null,
            options: null,
          },
          {
            type: 'image',
            alt: 'Logo',
            caption: null,
          },
        ]),
      ],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.sections[0].blocks[1]).toEqual({
      type: 'image',
      alt: 'Logo',
    })

    const invalid = { title: 'x', sections: [] }
    expect(DocumentOutlineAnswerSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─── prompts ─────────────────────────────────────────────────────────────

describe('prompts', () => {
  it('should state the import and prompt rules in English', () => {
    const importSystem = buildImportSystem()
    expect(importSystem).toMatch(/Keep the source text faithfully/)
    expect(importSystem).toMatch(/accept block/)
    expect(importSystem).toMatch(/\{\{contato\.nome\}\}/)
    expect(buildPromptSystem()).toMatch(/Brazilian Portuguese/)
  })

  it('should build the user messages with the hints', () => {
    const pdf = pdfImportContent({
      base64: 'AAAA',
      fileName: 'a.pdf',
      kind: 'OTHER',
    })
    expect(pdf[0]).toEqual({
      type: 'document',
      mediaType: 'application/pdf',
      data: 'AAAA',
      filename: 'a.pdf',
    })
    expect(pdf[1]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining('Type of document: detect it.'),
      }),
    )

    const text = textImportContent({
      text: 'corpo',
      fileName: 'b.docx',
      kind: 'QUOTE',
      title: 'Orçamento X',
    })
    expect(text).toContain('QUOTE (Orçamento)')
    expect(text).toContain('Title chosen by the user: Orçamento X')
    expect(text).toContain('corpo')

    const request = promptContent({ prompt: 'Faça um contrato', kind: 'OTHER' })
    expect(request).toContain('<pedido>\nFaça um contrato\n</pedido>')
  })

  it('should bound the extracted text', () => {
    expect(boundText('abc')).toEqual({ text: 'abc', truncated: false })
    const long = boundText('x'.repeat(300_001))
    expect(long.truncated).toBe(true)
    expect(long.text).toHaveLength(300_000)
  })
})

// ─── progress, estimate and constants ───────────────────────────────────

describe('progress', () => {
  it('should label the steps for files and prompts', () => {
    expect(progressOf('reading')).toEqual({
      step: 'reading',
      message: 'Lendo o arquivo',
      pct: 10,
    })
    expect(progressOf('reading', true).message).toBe('Lendo o pedido')
    expect(failedProgress('Erro')).toEqual({
      step: 'failed',
      message: 'Erro',
      pct: 100,
    })
  })

  it('should move the bar with the streamed answer, up to 80%', () => {
    expect(streamingProgress(0, 1000)).toEqual({
      step: 'structure',
      message: 'Entendendo a estrutura',
      pct: 25,
    })
    expect(streamingProgress(500, 1000, true)).toEqual({
      step: 'sections',
      message: 'Montando as seções',
      pct: 53,
    })
    expect(streamingProgress(5000, 1000).pct).toBe(80)
    expect(streamingProgress(10, 0).pct).toBe(80)
  })

  it('should read stored progress defensively', () => {
    expect(parseProgress(null)).toEqual({})
    expect(parseProgress('x')).toEqual({})
    const stored = { step: 'done', message: 'Pronto', pct: 100 }
    expect(parseProgress(stored)).toEqual(stored)
  })
})

describe('estimate', () => {
  it('should price the typical usage with the margin', () => {
    const estimate = estimateDocumentAi(
      { inputUsdPer1M: 2, outputUsdPer1M: 10 },
      1,
    )
    expect(estimate).toEqual({
      baseUsd: 0.01,
      pageUsd: 0.013,
      promptUsd: 0.062,
    })
    expect(estimateDocumentImport(estimate, 10)).toBe(0.14)
    expect(estimateDocumentImport(estimate, 0)).toBe(0.023)
  })

  it('should guess pages from the size within the limit', () => {
    expect(guessPages(10, 60)).toBe(1)
    expect(guessPages(600_000, 60)).toBe(10)
    expect(guessPages(50_000_000, 60)).toBe(60)
  })
})

describe('constants', () => {
  it('should build safe keys and display names', () => {
    expect(documentImportKey('ws', 'imp', 'Proposta Final (2).pdf')).toBe(
      'ws/imports/imp/Proposta_Final_2_.pdf',
    )
    expect(documentImportKey('ws', 'imp', '***')).toBe('ws/imports/imp/_')
    expect(documentImportFileName('/tmp/x/a.pdf')).toBe('a.pdf')
    expect(documentImportFileName('  ')).toBe('arquivo')
  })

  it('should know which models read PDFs and their output caps', () => {
    const claude = { provider: 'anthropic', model: 'claude-haiku-4-5' } as const
    const gpt = { provider: 'openai', model: 'gpt-4.1-mini' } as const
    const legacy = { provider: 'openai', model: 'o-legacy' } as const
    expect(acceptsPdfInput(claude)).toBe(true)
    expect(acceptsPdfInput(gpt)).toBe(true)
    expect(acceptsPdfInput(legacy)).toBe(false)
    expect(outlineMaxTokens({ model: 'gpt-4o-mini' })).toBe(16_000)
    expect(outlineMaxTokens({ model: 'claude-sonnet-5' })).toBe(48_000)
  })
})

// ─── extract ─────────────────────────────────────────────────────────────

function textItem([str, y]: [string, number]) {
  return { str, transform: [0, 0, 0, 0, 0, y] }
}

function page(items: [string, number][]) {
  return {
    getTextContent: async () => ({ items: items.map(textItem) }),
  }
}

describe('extract', () => {
  beforeEach(() => {
    parse.mockReset()
  })

  it('should recognize PDFs and DOCX by their bytes', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7'))).toBe(true)
    expect(looksLikePdf(Buffer.from('\n\n%PDF-1.4'))).toBe(true)
    expect(looksLikePdf(Buffer.from('PK'))).toBe(false)
    expect(looksLikeDocx(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true)
    expect(looksLikeDocx(Buffer.from('%PDF'))).toBe(false)
  })

  it('should count pages reading only the first one', async () => {
    parse.mockResolvedValueOnce({ numpages: 7 } as never)
    expect(await countPdfPages(Buffer.from('x'))).toEqual(ok(7))
    expect(parse).toHaveBeenCalledWith(expect.any(Buffer), { max: 1 })

    parse.mockRejectedValueOnce(new Error('encrypted'))
    const failed = await countPdfPages(Buffer.from('x'))
    expect(failed.ok).toBe(false)
  })

  it('should extract the text of each page in order', async () => {
    parse.mockImplementationOnce(async (_buffer, options) => {
      const render = options?.pagerender as (page: unknown) => Promise<string>
      await render(
        page([
          ['Linha 1', 10],
          [' cont.', 10],
          ['Linha 2', 20],
        ]),
      )
      await render({ getTextContent: async () => Promise.reject(new Error()) })
      return { numpages: 2 } as never
    })

    expect(await extractPdfPages(Buffer.from('x'))).toEqual(
      ok(['Linha 1 cont.\nLinha 2', '']),
    )

    parse.mockRejectedValueOnce(new Error('broken'))
    expect((await extractPdfPages(Buffer.from('x'))).ok).toBe(false)
  })

  it('should read a DOCX through the attachment extraction', async () => {
    knowledgeText.mockResolvedValueOnce(ok('  Contrato \n\n\n\n Cláusula  '))
    expect(await extractDocxText(Buffer.from('x'))).toEqual(
      ok('Contrato\n\n Cláusula'),
    )

    knowledgeText.mockResolvedValueOnce({ ok: false, error: 'bad zip' })
    expect((await extractDocxText(Buffer.from('x'))).ok).toBe(false)
  })

  it('should wrap pages for the model', () => {
    expect(pagesAsText(['a', ''])).toBe(
      '<pagina numero="1">\na\n</pagina>\n\n<pagina numero="2">\n[página sem texto]\n</pagina>',
    )
  })
})
