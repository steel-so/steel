import { describe, expect, it } from 'vitest'
import {
  AI_MEDIA_TOOL_NAME,
  aiMediaKeyFromName,
  buildAiMediaSection,
  buildAiMediaTool,
  classifyAiMedia,
  parseAiMediaCall,
} from '@/src/lib/whatsapp/ai-media'

const items = [
  {
    key: 'print_do_painel',
    name: 'Print do painel',
    whenToSend: 'Quando o cliente pedir um print',
    mediaType: 'IMAGE' as const,
  },
  {
    key: 'demo',
    name: 'Demonstração',
    whenToSend: 'Quando pedir uma demonstração',
    mediaType: 'VIDEO' as const,
  },
]

describe('aiMediaKeyFromName', () => {
  it('makes a stable snake_case id without accents', () => {
    expect(aiMediaKeyFromName('Print do Painel')).toBe('print_do_painel')
    expect(aiMediaKeyFromName('  Demonstração — vídeo #1 ')).toBe(
      'demonstracao_video_1',
    )
  })
  it('refuses a name with nothing usable', () => {
    expect(aiMediaKeyFromName('!!!')).toBeNull()
    expect(aiMediaKeyFromName('')).toBeNull()
  })
  it('caps the length', () => {
    expect(aiMediaKeyFromName('a'.repeat(100))?.length).toBeLessThanOrEqual(40)
  })
})

describe('classifyAiMedia', () => {
  it('accepts JPG/PNG up to 5 MB and MP4/3GPP up to 16 MB', () => {
    expect(classifyAiMedia('image/png', 1000)).toEqual({
      ok: true,
      mediaType: 'IMAGE',
    })
    expect(classifyAiMedia('image/jpeg; charset=x', 1000)).toMatchObject({
      ok: true,
    })
    expect(classifyAiMedia('video/mp4', 15 * 1024 * 1024)).toEqual({
      ok: true,
      mediaType: 'VIDEO',
    })
  })
  it('refuses oversized files and other formats', () => {
    expect(classifyAiMedia('image/png', 6 * 1024 * 1024)).toMatchObject({
      ok: false,
    })
    expect(classifyAiMedia('video/mp4', 17 * 1024 * 1024)).toMatchObject({
      ok: false,
    })
    expect(classifyAiMedia('video/webm', 100)).toMatchObject({ ok: false })
    expect(classifyAiMedia('image/gif', 100)).toMatchObject({ ok: false })
    expect(classifyAiMedia('application/pdf', 100)).toMatchObject({ ok: false })
  })
})

describe('AI media tool and prompt', () => {
  it('lists every file with its rule', () => {
    const section = buildAiMediaSection(items)
    expect(section).toContain('print_do_painel (imagem')
    expect(section).toContain('Quando o cliente pedir um print')
    expect(section).toContain('demo (vídeo')
    expect(buildAiMediaSection([])).toBe('')
  })

  it('restricts the tool to the library keys', () => {
    const tool = buildAiMediaTool(items)
    expect(tool.name).toBe(AI_MEDIA_TOOL_NAME)
    expect(
      (tool.parameters as { properties: { arquivo: { enum: string[] } } })
        .properties.arquivo.enum,
    ).toEqual(['print_do_painel', 'demo'])
  })

  it('resolves a call to its item, and ignores unknown ones', () => {
    const call = (arquivo: unknown, name = AI_MEDIA_TOOL_NAME) => ({
      id: 't1',
      name,
      arguments: { arquivo },
    })
    expect(parseAiMediaCall(items, call('demo'))?.key).toBe('demo')
    expect(parseAiMediaCall(items, call('outro'))).toBeNull()
    expect(parseAiMediaCall(items, call(42))).toBeNull()
    expect(parseAiMediaCall(items, call('demo', 'outra_ferramenta'))).toBeNull()
  })
})
