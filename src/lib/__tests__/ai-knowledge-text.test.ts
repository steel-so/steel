import { describe, expect, it } from 'vitest'
import {
  CHUNK_OVERLAP_CHARS,
  CHUNK_TARGET_CHARS,
  chunkKnowledgeText,
  jsonToKnowledgeText,
  knowledgeContentHash,
  MAX_CHUNKS_PER_SOURCE,
  normalizeKnowledgeText,
} from '@/src/lib/ai/knowledge/chunking'
import {
  bestChunkPerSource,
  fuseRankings,
  RRF_K,
  snippetAround,
} from '@/src/lib/ai/knowledge/fusion'
import {
  isKnowledgeSourceType,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_SOURCES,
  knowledgeSourceLabel,
} from '@/src/lib/ai/knowledge/sources'

describe('normalizeKnowledgeText', () => {
  it('should collapse spaces and blank lines but keep line breaks', () => {
    expect(normalizeKnowledgeText('  a\t  b \r\n\r\n\r\n\n c  \n d ')).toBe(
      'a b\n\nc\nd',
    )
  })
})

describe('chunkKnowledgeText', () => {
  it('should return nothing for empty text and one chunk for short text', () => {
    expect(chunkKnowledgeText('   \n ')).toEqual([])
    expect(chunkKnowledgeText('Curto.')).toEqual(['Curto.'])
  })

  it('should cut long text at paragraph boundaries with overlap', () => {
    const paragraph = `${'palavra '.repeat(100).trim()}.`
    const text = Array.from({ length: 6 }, () => paragraph).join('\n\n')
    const chunks = chunkKnowledgeText(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS)
      // Never starts in the middle of a word.
      expect(chunk.startsWith('alavra')).toBe(false)
    }
    // The overlap repeats the end of a chunk at the start of the next one.
    const tail = chunks[0].slice(-40)
    expect(chunks[1].includes(tail.trim().split(' ').slice(-2).join(' '))).toBe(
      true,
    )
    expect(CHUNK_OVERLAP_CHARS).toBeLessThan(CHUNK_TARGET_CHARS)
  })

  it('should cut unbroken text at the target and cap the number of chunks', () => {
    const blob = 'x'.repeat(50)
    expect(chunkKnowledgeText(blob, { target: 20, overlap: 5 })).toEqual([
      'x'.repeat(20),
      'x'.repeat(20),
      'x'.repeat(20),
    ])
    const many = chunkKnowledgeText('frase curta. '.repeat(5000))
    expect(many).toHaveLength(MAX_CHUNKS_PER_SOURCE)
    expect(
      chunkKnowledgeText('a b c d e f g h', { target: 4, maxChunks: 2 }),
    ).toHaveLength(2)
  })

  it('should skip a whitespace-only window', () => {
    // The overlap lands the next window on blanks only.
    expect(
      chunkKnowledgeText('abcd\n\n\n\nefgh', { target: 6, overlap: 0 }),
    ).toEqual(['abcd', 'efgh'])
  })

  it('should prefer sentence ends when there is no line break', () => {
    const text = `${'a'.repeat(30)}. ${'b'.repeat(30)}. ${'c'.repeat(30)}.`
    const chunks = chunkKnowledgeText(text, { target: 70, overlap: 0 })
    expect(chunks[0]).toBe(`${'a'.repeat(30)}. ${'b'.repeat(30)}.`)
  })
})

describe('knowledgeContentHash', () => {
  it('should change with the title or the content', () => {
    const base = knowledgeContentHash('t', 'c')
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(knowledgeContentHash('t', 'c')).toBe(base)
    expect(knowledgeContentHash('t2', 'c')).not.toBe(base)
    expect(knowledgeContentHash('t', 'c2')).not.toBe(base)
  })
})

describe('jsonToKnowledgeText', () => {
  it('should keep prose and skip ids, urls, colors and non-prose keys', () => {
    const text = jsonToKnowledgeText({
      id: 'abc',
      title: 'Proposta comercial',
      logoUrl: 'https://x/y.png',
      color: '#ff0000',
      blocks: [
        { type: 'p', children: [{ text: 'Escopo do projeto', bold: true }] },
        { text: 'https://link' },
        { text: '#abc' },
        { text: '   ' },
        null,
        42,
      ],
    })
    expect(text).toBe('Proposta comercial\nEscopo do projeto')
  })

  it('should bound the size and the depth', () => {
    expect(jsonToKnowledgeText(['abcdef', 'ghij'], 5)).toBe('abcde')
    let deep: unknown = 'fundo'
    for (let i = 0; i < 60; i++) deep = [deep]
    expect(jsonToKnowledgeText(deep)).toBe('')
  })
})

describe('fuseRankings', () => {
  const a = { id: 'a', sourceType: 'wiki-page', sourceId: 's1' }
  const b = { id: 'b', sourceType: 'wiki-page', sourceId: 's1' }
  const c = { id: 'c', sourceType: 'crm-note', sourceId: 's2' }

  it('should reward chunks both rankings agree on', () => {
    const fused = fuseRankings([a, c], [c, b])
    expect(fused.map((f) => f.chunk.id)).toEqual(['c', 'a', 'b'])
    expect(fused[0].score).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1))
    expect(fused[0].ranks).toEqual({ text: 2, vector: 1 })
    expect(fused[2].ranks).toEqual({ vector: 2 })
  })

  it('should ignore repeats inside one list and break ties by id', () => {
    const fused = fuseRankings([a, a], [])
    expect(fused).toHaveLength(1)
    expect(fused[0].ranks).toEqual({ text: 1 })
    expect(fuseRankings([b], [a]).map((f) => f.chunk.id)).toEqual(['a', 'b'])
  })

  it('should keep one entry per source, in order, up to the limit', () => {
    const fused = fuseRankings([a, b, c], [])
    expect(bestChunkPerSource(fused, 10).map((f) => f.chunk.id)).toEqual([
      'a',
      'c',
    ])
    expect(bestChunkPerSource(fused, 1).map((f) => f.chunk.id)).toEqual(['a'])
  })
})

describe('snippetAround', () => {
  it('should return short text whole', () => {
    expect(snippetAround('  curto   texto ', ['x'])).toBe('curto texto')
  })

  it('should center on the first query word, ignoring accents', () => {
    const text = `${'a '.repeat(300)}Configuração da VPN ${'b '.repeat(300)}`
    const snippet = snippetAround(text, ['vpn', 'configuracao', 'de'], 100)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('Configuração da VPN')
  })

  it('should end without an ellipsis when the window reaches the end', () => {
    const text = `${'a '.repeat(100)}final VPN`
    const snippet = snippetAround(text, ['vpn'], 60)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('VPN')).toBe(true)
  })

  it('should start at the beginning when no word matches', () => {
    const text = 'x '.repeat(400)
    const snippet = snippetAround(text, ['zzz'], 50)
    expect(snippet.startsWith('…')).toBe(false)
    expect(snippet.endsWith('…')).toBe(true)
  })
})

describe('knowledge sources', () => {
  it('should describe every source type', () => {
    for (const type of KNOWLEDGE_SOURCE_TYPES) {
      expect(KNOWLEDGE_SOURCES[type].label).toBeTruthy()
      expect(isKnowledgeSourceType(type)).toBe(true)
      expect(knowledgeSourceLabel(type)).toBe(KNOWLEDGE_SOURCES[type].label)
    }
    expect(isKnowledgeSourceType('crm-lead')).toBe(false)
    expect(knowledgeSourceLabel('crm-lead')).toBe('Fonte')
  })
})
