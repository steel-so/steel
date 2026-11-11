import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import {
  createAnthropicProvider,
  toAnthropicMessages,
} from '../ai/anthropic-provider'
import { createOpenAiProvider } from '../ai/openai-provider'
import type { AiDocumentPart } from '../ai/types'

const PDF: AiDocumentPart = {
  type: 'document',
  mediaType: 'application/pdf',
  data: 'JVBERi0xLjQK',
  filename: 'contrato.pdf',
}
const UNNAMED: AiDocumentPart = { ...PDF, filename: undefined }

describe('document content part', () => {
  describe('Anthropic', () => {
    it('should send the PDF as a titled base64 document block', () => {
      const messages = toAnthropicMessages([
        {
          role: 'user',
          content: [PDF, { type: 'text', text: 'Monte o documento' }],
        },
      ])

      expect(messages).toEqual([
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: 'JVBERi0xLjQK',
              },
              title: 'contrato.pdf',
            },
            { type: 'text', text: 'Monte o documento' },
          ],
        },
      ])
    })

    it('should leave the title out without a file name', async () => {
      const create = vi.fn().mockResolvedValue({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: '{}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3000, output_tokens: 10 },
      })
      const client = { messages: { create } } as unknown as Anthropic

      await createAnthropicProvider(client).chat({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: [UNNAMED] }],
      })

      const block = create.mock.calls[0][0].messages[0].content[0]
      expect(block.type).toBe('document')
      expect(block).not.toHaveProperty('title')
    })
  })

  describe('OpenAI', () => {
    function fakeClient() {
      const create = vi.fn().mockResolvedValue({
        output: [],
        output_text: '{}',
        usage: { input_tokens: 3000, output_tokens: 10 },
      })
      return { client: { responses: { create } } as unknown as OpenAI, create }
    }

    it('should send the PDF as an input_file with a data URL', async () => {
      const { client, create } = fakeClient()

      await createOpenAiProvider(client).chat({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'user',
            content: [PDF, { type: 'text', text: 'Monte o documento' }],
          },
        ],
      })

      expect(create.mock.calls[0][0].input[0].content).toEqual([
        {
          type: 'input_file',
          filename: 'contrato.pdf',
          file_data: 'data:application/pdf;base64,JVBERi0xLjQK',
        },
        { type: 'input_text', text: 'Monte o documento' },
      ])
    })

    it('should name the file when the part has no file name', async () => {
      const { client, create } = fakeClient()

      await createOpenAiProvider(client).chat({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: [UNNAMED] }],
      })

      expect(create.mock.calls[0][0].input[0].content[0].filename).toBe(
        'documento.pdf',
      )
    })
  })
})
