import type { AiProviderId } from './models'

/**
 * Abstração de chat independente de provedor. Cobre exatamente o que as
 * funcionalidades do produto usam hoje: system prompt, histórico com texto
 * e imagens, tool calling (function tools + busca web nativa do provedor),
 * saída JSON com schema e contagem de tokens. `chatStream` entrega o texto
 * token a token (Steel AI) e termina com a mesma resposta que `chat`.
 */

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | AiDocumentPart

/**
 * A whole PDF sent natively (Anthropic `document` block, OpenAI
 * `input_file`): the model reads the text and the page images. `data` is
 * the file in base64, without the `data:` prefix. Callers that may hit a
 * model without PDF input check `acceptsPdfInput` first and send the
 * extracted text instead.
 */
export interface AiDocumentPart {
  type: 'document'
  mediaType: 'application/pdf'
  data: string
  filename?: string
}

export interface AiToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * Turno do assistente. `raw` guarda o conteúdo nativo do provedor que o
 * gerou (blocos de thinking, chamadas de busca web, itens de reasoning) —
 * reenviado sem alteração na rodada seguinte do loop de tools, como os dois
 * provedores exigem. Ignorado se o histórico for enviado a outro provedor.
 */
export interface AiAssistantMessage {
  role: 'assistant'
  content: string
  toolCalls?: AiToolCall[]
  raw?: { provider: AiProviderId; content: unknown }
}

export type AiMessage =
  | { role: 'user'; content: string | AiContentPart[] }
  | AiAssistantMessage
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface AiToolSpec {
  name: string
  description: string
  /** JSON Schema de um objeto. */
  parameters: Record<string, unknown>
}

export interface AiChatRequest {
  model: string
  system?: string
  messages: AiMessage[]
  tools?: AiToolSpec[]
  /** Habilita a busca web nativa do provedor. */
  webSearch?: boolean
  /** `none` mantém as tools declaradas mas força resposta em texto. */
  toolChoice?: 'auto' | 'none'
  /** Força saída JSON aderente ao schema (structured outputs). */
  jsonSchema?: { name: string; schema: Record<string, unknown> }
  maxTokens?: number
}

export interface AiUsageTokens {
  /** Every input token, cached ones included. */
  inputTokens: number
  outputTokens: number
  /** Part of `inputTokens` served from the provider cache, when reported. */
  cachedInputTokens?: number
}

export type AiStopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal'

export interface AiChatResponse {
  text: string
  toolCalls: AiToolCall[]
  /** Pronto para ser anexado ao histórico da próxima rodada. */
  message: AiAssistantMessage
  usage: AiUsageTokens
  stopReason: AiStopReason
}

/**
 * Event of a streamed chat: text deltas as they arrive, then exactly one
 * `done` carrying the same response `chat` would return (tool calls, `raw`
 * and usage included).
 */
export type AiStreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'done'; response: AiChatResponse }

export interface AiProvider {
  readonly id: AiProviderId
  chat(request: AiChatRequest): Promise<AiChatResponse>
  chatStream(request: AiChatRequest): AsyncIterable<AiStreamChunk>
}

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Argumentos malformados do modelo — segue com objeto vazio; a tool
      // valida o payload e devolve erro legível pro modelo tentar de novo.
    }
  }
  return {}
}
