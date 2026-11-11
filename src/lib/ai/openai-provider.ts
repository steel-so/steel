import type OpenAI from 'openai'
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

type InputItem = OpenAI.Responses.ResponseInputItem

type InputContent = OpenAI.Responses.ResponseInputMessageContentList[number]

function inputPart(part: AiContentPart): InputContent {
  if (part.type === 'text') return { type: 'input_text', text: part.text }
  if (part.type === 'image') {
    return { type: 'input_image', image_url: part.url, detail: 'auto' }
  }
  return {
    type: 'input_file',
    filename: part.filename ?? 'documento.pdf',
    file_data: `data:${part.mediaType};base64,${part.data}`,
  }
}

function toUserContent(
  content: string | AiContentPart[],
): string | OpenAI.Responses.ResponseInputMessageContentList {
  if (typeof content === 'string') return content
  return content.map(inputPart)
}

function toInput(system: string | undefined, messages: AiMessage[]) {
  const input: InputItem[] = []
  if (system) input.push({ role: 'system', content: system })

  for (const message of messages) {
    if (message.role === 'user') {
      input.push({ role: 'user', content: toUserContent(message.content) })
      continue
    }

    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content,
      })
      continue
    }

    // Assistente: reenvia os itens nativos (function_call, reasoning,
    // web_search_call...) quando vieram da própria OpenAI — modelos de
    // raciocínio rejeitam function_call sem o item de reasoning que o gerou.
    if (message.raw?.provider === 'openai') {
      input.push(...(message.raw.content as InputItem[]))
      continue
    }

    if (message.content) {
      input.push({ role: 'assistant', content: message.content })
    }
    for (const call of message.toolCalls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      })
    }
  }

  return input
}

function buildParams(
  request: AiChatRequest,
): OpenAI.Responses.ResponseCreateParamsNonStreaming {
  const tools: OpenAI.Responses.Tool[] = [
    ...(request.webSearch ? [{ type: 'web_search' as const }] : []),
    ...(request.tools ?? []).map(
      (tool): OpenAI.Responses.FunctionTool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        strict: false,
        parameters: tool.parameters,
      }),
    ),
  ]

  return {
    model: request.model,
    input: toInput(request.system, request.messages),
    ...(tools.length > 0 && { tools }),
    ...(tools.length > 0 &&
      request.toolChoice && { tool_choice: request.toolChoice }),
    ...(request.jsonSchema && {
      text: {
        format: {
          type: 'json_schema' as const,
          name: request.jsonSchema.name,
          schema: request.jsonSchema.schema,
          strict: true,
        },
      },
    }),
    ...(request.maxTokens && { max_output_tokens: request.maxTokens }),
  }
}

/** Text of the response: `output_text` when present, else the message parts. */
function outputText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === 'string') return response.output_text
  return response.output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .map((part) => (part.type === 'output_text' ? part.text : ''))
    .join('')
}

function toChatResponse(response: OpenAI.Responses.Response): AiChatResponse {
  const toolCalls: AiToolCall[] = response.output
    .filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === 'function_call',
    )
    .map((call) => ({
      id: call.call_id,
      name: call.name,
      arguments: parseToolArguments(call.arguments),
    }))

  const refused = response.output.some(
    (item) =>
      item.type === 'message' &&
      item.content.some((part) => part.type === 'refusal'),
  )
  const text = outputText(response)
  const cachedTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0

  return {
    text,
    toolCalls,
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 && { toolCalls }),
      raw: { provider: 'openai', content: response.output },
    },
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      // Automatic prompt caching: billed at the cached-input price.
      ...(cachedTokens > 0 && { cachedInputTokens: cachedTokens }),
    },
    stopReason:
      toolCalls.length > 0
        ? 'tool_use'
        : refused
          ? 'refusal'
          : response.incomplete_details?.reason === 'max_output_tokens'
            ? 'max_tokens'
            : 'end',
  }
}

/**
 * Adaptador da OpenAI sobre a Responses API (a mesma que o assistente do
 * CRM já usava). Recebe o client pronto para os testes injetarem um fake.
 */
export function createOpenAiProvider(client: OpenAI): AiProvider {
  return {
    id: 'openai',
    async chat(request: AiChatRequest): Promise<AiChatResponse> {
      const response = await client.responses.create(buildParams(request))
      return toChatResponse(response)
    },

    async *chatStream(request: AiChatRequest): AsyncIterable<AiStreamChunk> {
      const stream = await client.responses.create({
        ...buildParams(request),
        stream: true,
      })

      let final: OpenAI.Responses.Response | null = null
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield { type: 'text', delta: event.delta }
        } else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete'
        ) {
          final = event.response
        } else if (event.type === 'response.failed') {
          throw new Error(
            event.response.error?.message ?? 'OpenAI response failed',
          )
        } else if (event.type === 'error') {
          throw new Error(event.message)
        }
      }
      if (!final) throw new Error('OpenAI stream ended without a response')

      yield { type: 'done', response: toChatResponse(final) }
    },
  }
}
