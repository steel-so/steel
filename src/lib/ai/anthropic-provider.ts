import type Anthropic from '@anthropic-ai/sdk'
import {
  type AiChatRequest,
  type AiChatResponse,
  type AiContentPart,
  type AiMessage,
  type AiProvider,
  type AiStreamChunk,
  type AiToolCall,
  parseToolArguments,
} from './types'

type MessageParam = Anthropic.MessageParam
type ContentBlockParam = Anthropic.ContentBlockParam
type ContentBlock = Anthropic.ContentBlock
type ToolUnion = Anthropic.ToolUnion
type CreateParams = Anthropic.MessageCreateParamsNonStreaming

/** Teto de saída padrão para requisições não-streaming (evita timeout HTTP). */
const DEFAULT_MAX_TOKENS = 16_000
/** Continuações de `pause_turn` (loop server-side da busca web). */
const MAX_PAUSE_CONTINUATIONS = 5
/** Modelos sem suporte à versão com filtragem dinâmica da busca web. */
const BASIC_WEB_SEARCH_MODELS = new Set(['claude-haiku-4-5'])

const DATA_URL =
  /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/

/**
 * Image block: a `data:` URL (private files sent inline) becomes a base64
 * source — Anthropic's `url` source only takes http(s) URLs.
 */
function imageBlock(url: string): ContentBlockParam {
  const inline = DATA_URL.exec(url)
  if (inline) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: inline[1] as 'image/png',
        data: inline[2],
      },
    }
  }
  return { type: 'image', source: { type: 'url', url } }
}

function partBlock(part: AiContentPart): ContentBlockParam {
  if (part.type === 'text') {
    return { type: 'text', text: part.text || '(vazio)' }
  }
  if (part.type === 'image') return imageBlock(part.url)
  return {
    type: 'document',
    source: { type: 'base64', media_type: part.mediaType, data: part.data },
    ...(part.filename && { title: part.filename }),
  }
}

function toUserContent(
  content: string | AiContentPart[],
): string | ContentBlockParam[] {
  if (typeof content === 'string') return content.trim() ? content : '(vazio)'
  return content.map(partBlock)
}

export function toAnthropicMessages(messages: AiMessage[]): MessageParam[] {
  const result: MessageParam[] = []
  let pendingToolResults: ContentBlockParam[] = []

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return
    // Todos os tool_result de um turno vão numa única mensagem de usuário.
    result.push({ role: 'user', content: pendingToolResults })
    pendingToolResults = []
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      })
      continue
    }
    flushToolResults()

    if (message.role === 'user') {
      result.push({ role: 'user', content: toUserContent(message.content) })
      continue
    }

    // Reenvia os blocos nativos sem alteração (thinking, server_tool_use,
    // tool_use): a API exige o turno do assistente intacto no loop de tools.
    if (message.raw?.provider === 'anthropic') {
      result.push({
        role: 'assistant',
        content: message.raw.content as ContentBlockParam[],
      })
      continue
    }

    const blocks: ContentBlockParam[] = []
    if (message.content.trim()) {
      blocks.push({ type: 'text', text: message.content })
    }
    for (const call of message.toolCalls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.arguments,
      })
    }
    if (blocks.length > 0) result.push({ role: 'assistant', content: blocks })
  }
  flushToolResults()

  // A conversa precisa começar pelo usuário (históricos de WhatsApp podem
  // começar com uma mensagem enviada pela empresa).
  if (result[0]?.role === 'assistant') {
    result.unshift({ role: 'user', content: '(início da conversa)' })
  }
  return result
}

function buildTools(request: AiChatRequest): ToolUnion[] {
  const tools: ToolUnion[] = (request.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  }))
  if (request.webSearch) {
    tools.unshift(
      BASIC_WEB_SEARCH_MODELS.has(request.model)
        ? { type: 'web_search_20250305', name: 'web_search' }
        : { type: 'web_search_20260209', name: 'web_search' },
    )
  }
  return tools
}

function buildParams(request: AiChatRequest): CreateParams {
  const tools = buildTools(request)
  return {
    model: request.model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: toAnthropicMessages(request.messages),
    ...(request.system && { system: request.system }),
    ...(tools.length > 0 && { tools }),
    ...(tools.length > 0 &&
      request.toolChoice && { tool_choice: { type: request.toolChoice } }),
    ...(request.jsonSchema && {
      output_config: {
        format: { type: 'json_schema', schema: request.jsonSchema.schema },
      },
    }),
  }
}

function inputTokensOf(usage: Anthropic.Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  )
}

/** Continuation request after a `pause_turn` (server-side web search loop). */
function continuation(
  params: CreateParams,
  content: ContentBlock[],
): CreateParams {
  return {
    ...params,
    messages: [
      ...params.messages,
      { role: 'assistant', content: [...content] as ContentBlockParam[] },
    ],
  }
}

function toChatResponse(
  content: ContentBlock[],
  usage: { inputTokens: number; outputTokens: number },
  stopReason: Anthropic.Message['stop_reason'],
): AiChatResponse {
  const toolCalls: AiToolCall[] = content
    .filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: parseToolArguments(block.input),
    }))

  const text = content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()

  return {
    text,
    toolCalls,
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 && { toolCalls }),
      raw: { provider: 'anthropic', content },
    },
    usage,
    stopReason:
      stopReason === 'refusal'
        ? 'refusal'
        : toolCalls.length > 0
          ? 'tool_use'
          : stopReason === 'max_tokens'
            ? 'max_tokens'
            : 'end',
  }
}

/**
 * Adaptador do Claude (Anthropic Messages API, sem betas). Recusas dos
 * classificadores de segurança (`stop_reason: 'refusal'`) são devolvidas
 * como `stopReason: 'refusal'` — sem fallback automático para outro modelo
 * (decisão da ADR 0007: comportamento previsível, o chamador decide).
 */
export function createAnthropicProvider(client: Anthropic): AiProvider {
  return {
    id: 'anthropic',
    async chat(request: AiChatRequest): Promise<AiChatResponse> {
      const params = buildParams(request)
      const content: ContentBlock[] = []
      let inputTokens = 0
      let outputTokens = 0
      let response = await client.messages.create(params)

      for (let i = 0; ; i++) {
        content.push(...response.content)
        inputTokens += inputTokensOf(response.usage)
        outputTokens += response.usage.output_tokens

        // A busca web roda num loop server-side que pode pausar; reenviar o
        // turno do assistente faz a API retomar de onde parou.
        if (
          response.stop_reason !== 'pause_turn' ||
          i >= MAX_PAUSE_CONTINUATIONS
        ) {
          break
        }
        response = await client.messages.create(continuation(params, content))
      }

      return toChatResponse(
        content,
        { inputTokens, outputTokens },
        response.stop_reason,
      )
    },

    async *chatStream(request: AiChatRequest): AsyncIterable<AiStreamChunk> {
      const params = buildParams(request)
      const content: ContentBlock[] = []
      let inputTokens = 0
      let outputTokens = 0

      for (let i = 0; ; i++) {
        const stream = client.messages.stream(
          i === 0 ? params : continuation(params, content),
        )
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta' &&
            event.delta.text
          ) {
            yield { type: 'text', delta: event.delta.text }
          }
        }
        const response = await stream.finalMessage()
        content.push(...response.content)
        inputTokens += inputTokensOf(response.usage)
        outputTokens += response.usage.output_tokens

        if (
          response.stop_reason !== 'pause_turn' ||
          i >= MAX_PAUSE_CONTINUATIONS
        ) {
          yield {
            type: 'done',
            response: toChatResponse(
              content,
              { inputTokens, outputTokens },
              response.stop_reason,
            ),
          }
          return
        }
      }
    },
  }
}
