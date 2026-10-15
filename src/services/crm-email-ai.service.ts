import { logger } from '@/lib/axiom/logger'
import { crmEmailAiFailed, notFound, validationError } from '@/src/errors'
import type { AiChatResponse } from '@/src/lib/ai/types'
import {
  buildAiSection,
  EMAIL_AI_FIELDS,
  EMAIL_AI_SECTION_JSON_SCHEMA,
  type EmailAiField,
  EmailAiSectionOutputSchema,
  fitAiText,
} from '@/src/lib/canvas-email/ai-blocks'
import { EMAIL_VARIABLES } from '@/src/lib/crm-email-builder/variables'
import { err, ok, type Result } from '@/src/lib/result'
import { toEmailProductData } from '@/src/mappers/crm-email-builder.mapper'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import type {
  CrmEmailAiRewriteDTO,
  CrmEmailAiSectionDTO,
} from '@/src/schemas/crm-email-editor.schema'
import { CrmTextAiOutputSchema } from '@/src/schemas/crm-text-ai.schema'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import type {
  CrmEmailAiRewriteResultDTO,
  CrmEmailAiSectionResultDTO,
} from '@/types/crm-email-editor'
import { AiUsageService } from './ai-usage.service'
import { assertModuleMember } from './authz'
import { assertFeature } from './feature-flag.service'

/**
 * AI on e-mail blocks (E3): write or rewrite the text of one block, and
 * generate a whole section from a prompt or a CRM product. Same gate as the
 * other CRM AI features (plan feature `crm.aiAssistant`), same model and
 * monthly quota through `AiUsageService` (ADR 0007). The output is checked
 * by the e-mail catalog — invalid nodes never reach the editor.
 */

const REWRITE_MAX_TOKENS = 2000
const SECTION_MAX_TOKENS = 3000

const REWRITE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'suggestion'],
  properties: {
    reply: { type: 'string' },
    suggestion: { type: 'string' },
  },
}

const VARIABLES = EMAIL_VARIABLES.filter((v) => v.pickable)
  .map((v) => `{{${v.key}}} (${v.label})`)
  .join(', ')

const BASE_RULES = [
  'Você é um redator de e-mail marketing B2B de uma empresa brasileira.',
  'Escreva em português do Brasil, a menos que o texto atual esteja em outro idioma — nesse caso, mantenha o idioma.',
  'Copy clara, específica e orientada ao benefício; nada de promessas que o texto ou o pedido não sustentem.',
  `Pode usar as variáveis de personalização exatamente nesta forma: ${VARIABLES}. Não invente outras.`,
  'Emojis só se o usuário pedir ou se o texto atual já usar.',
]

const MODE_INSTRUCTION: Record<CrmEmailAiRewriteDTO['mode'], string> = {
  write: 'Escreva o texto do campo a partir do pedido do usuário.',
  shorter:
    'Reescreva o texto mais curto e direto, mantendo a mensagem principal (no máximo metade do tamanho, quando possível).',
  persuasive:
    'Reescreva o texto mais persuasivo: benefício claro, urgência honesta e chamada para ação.',
  formal: 'Reescreva o texto num tom mais formal e profissional, sem gírias.',
}

/** Pure: system prompt for one field. */
export function buildRewriteSystem(
  dto: Pick<CrmEmailAiRewriteDTO, 'mode' | 'text' | 'subject'>,
  field: EmailAiField,
): string {
  const lines = [
    ...BASE_RULES,
    'Devolva JSON com "reply" (uma frase curta explicando o que mudou) e "suggestion" (o texto final do campo).',
    MODE_INSTRUCTION[dto.mode],
    `Campo: ${field.label}.`,
    field.rich
      ? 'O campo é texto rico: devolva HTML usando só <p>, <strong>, <em>, <u>, <a href="...">, <ul>, <ol>, <li> e <br>. Mantenha os links existentes.'
      : 'O campo é uma linha só: sem quebras de linha, aspas, markdown ou HTML.',
    `A sugestão deve ter no máximo ${field.rich ? 1500 : field.maxLength} caracteres.`,
  ]
  if (dto.subject) lines.push(`Assunto do e-mail: ${dto.subject}.`)
  lines.push(
    dto.text.trim()
      ? `Texto atual do campo:\n"""\n${dto.text}\n"""`
      : 'O campo está vazio — escreva do zero a partir do pedido.',
  )
  return lines.join('\n')
}

/** Pure: system prompt for a generated section. */
export function buildSectionSystem(
  dto: Pick<CrmEmailAiSectionDTO, 'subject'>,
  product: { name: string; description: string; price: string } | null,
): string {
  const lines = [
    ...BASE_RULES,
    'Monte UMA seção de e-mail e devolva JSON com "reply" (uma frase curta sobre a seção) e "section".',
    'section.background: "none" (fundo do e-mail) ou "soft" (faixa suave na cor da marca, para destaque).',
    'section.columns: de 1 a 3 colunas; use mais de uma só para conteúdo paralelo (benefícios lado a lado). Cada coluna tem "blocks" na ordem em que aparecem.',
    'Tipos de bloco e os campos que usam (deixe os outros como string vazia, "h2" ou lista vazia):',
    '- heading: text (título curto), level (h1 só para o título principal do e-mail; normalmente h2 ou h3).',
    '- text: text (1 a 3 parágrafos curtos separados por linha em branco).',
    '- button: text (rótulo curto, até 30 caracteres), url (vazio para usar o link da campanha).',
    '- list: items (2 a 5 itens com title e text curtos).',
    '- quote: text (depoimento), author, role.',
    '- coupon: code (código em maiúsculas), text (chamada do cupom).',
    '- divider: nenhum campo.',
    product
      ? '- product: nenhum campo — mostra o produto escolhido (nome, descrição e preço vêm do CRM). Use exatamente um.'
      : '- product: não use (nenhum produto foi escolhido).',
    'No máximo 6 blocos por coluna. Não invente preços, prazos ou dados que o pedido não traga.',
  ]
  if (dto.subject) lines.push(`Assunto do e-mail: ${dto.subject}.`)
  if (product) {
    lines.push(
      `Produto do CRM: ${product.name}${product.price ? ` — ${product.price}` : ''}.`,
    )
    if (product.description) lines.push(`Descrição: ${product.description}`)
  }
  return lines.join('\n')
}

type PreparedCall = Extract<
  Awaited<ReturnType<typeof AiUsageService.prepare>>,
  { ok: true }
>['value']

/** Gate (membership, plan feature, quota) shared by both actions. */
async function prepare(
  actorId: string,
  workspaceId: string,
): Promise<Result<PreparedCall>> {
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'email',
    action: 'EDIT',
  })
  if (!membership.ok) return membership
  const feature = await assertFeature(workspaceId, 'crm.aiAssistant')
  if (!feature.ok) return feature
  return AiUsageService.prepare(workspaceId, 'CRM_ASSISTANT', actorId)
}

/** One provider call, usage recorded; `null` when the provider failed. */
async function callProvider(
  call: PreparedCall,
  input: {
    actorId: string
    workspaceId: string
    system: string
    message: string
    schemaName: string
    schema: Record<string, unknown>
    maxTokens: number
    action: string
  },
): Promise<AiChatResponse | null> {
  try {
    const response = await call.provider.chat({
      model: call.model.model,
      system: input.system,
      messages: [{ role: 'user', content: input.message }],
      jsonSchema: { name: input.schemaName, schema: input.schema },
      maxTokens: input.maxTokens,
    })
    await AiUsageService.record(call, {
      workspaceId: input.workspaceId,
      userId: input.actorId,
      usage: response.usage,
      scope: { module: 'CRM' },
    })
    return response
  } catch (error) {
    logger.error('crm_email_ai.provider_failed', {
      component: 'CrmEmailAiService',
      workspaceId: input.workspaceId,
      action: input.action,
      provider: call.model.provider,
      model: call.model.model,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export const CrmEmailAiService = {
  /** "Escrever com IA" / "Reescrever" on one block's text. */
  async rewrite(
    actorId: string,
    workspaceId: string,
    dto: CrmEmailAiRewriteDTO,
  ): Promise<Result<CrmEmailAiRewriteResultDTO>> {
    const field = EMAIL_AI_FIELDS[dto.blockType]
    if (!field) {
      return err(validationError('Este bloco não tem texto para a IA escrever'))
    }
    if (dto.mode === 'write' && !dto.prompt) {
      return err(validationError('Diga o que a IA deve escrever'))
    }
    if (dto.mode !== 'write' && !dto.text.trim()) {
      return err(validationError('O bloco está vazio — use "Escrever com IA"'))
    }

    const call = await prepare(actorId, workspaceId)
    if (!call.ok) return call

    const response = await callProvider(call.value, {
      actorId,
      workspaceId,
      system: buildRewriteSystem(dto, field),
      message:
        dto.prompt ||
        'Reescreva o texto atual seguindo as instruções do sistema.',
      schemaName: 'email_block_copy',
      schema: REWRITE_JSON_SCHEMA,
      maxTokens: REWRITE_MAX_TOKENS,
      action: `rewrite:${dto.mode}`,
    })
    if (!response) return err(crmEmailAiFailed())

    const parsed = parseSdAiJson(CrmTextAiOutputSchema, response.text)
    const value = parsed && fitAiText(parsed.suggestion, field)
    if (!value) {
      logger.warn('crm_email_ai.invalid_rewrite', {
        component: 'CrmEmailAiService',
        workspaceId,
        blockType: dto.blockType,
        model: call.value.model.key,
      })
      return err(
        crmEmailAiFailed(
          'A IA não devolveu um texto aproveitável — tente de novo',
        ),
      )
    }
    logger.info('crm_email_ai.rewrite', {
      component: 'CrmEmailAiService',
      workspaceId,
      blockType: dto.blockType,
      mode: dto.mode,
      model: call.value.model.key,
    })
    return ok({ value })
  },

  /** "Gerar seção": a section from a prompt and/or a CRM product. */
  async generateSection(
    actorId: string,
    workspaceId: string,
    dto: CrmEmailAiSectionDTO,
  ): Promise<Result<CrmEmailAiSectionResultDTO>> {
    const call = await prepare(actorId, workspaceId)
    if (!call.ok) return call

    let product: { name: string; description: string; price: string } | null =
      null
    if (dto.productId) {
      const rows = await CrmEmailBuilderRepository.findProducts(workspaceId, [
        dto.productId,
      ])
      if (!rows.ok) return rows
      product = toEmailProductData(rows.value)[dto.productId] ?? null
      if (!product) return err(notFound('CrmProduct'))
    }

    const response = await callProvider(call.value, {
      actorId,
      workspaceId,
      system: buildSectionSystem(dto, product),
      message:
        dto.prompt ||
        `Monte uma seção que apresente o produto ${product?.name} e convide a comprar.`,
      schemaName: 'email_section',
      schema: EMAIL_AI_SECTION_JSON_SCHEMA,
      maxTokens: SECTION_MAX_TOKENS,
      action: 'section',
    })
    if (!response) return err(crmEmailAiFailed())

    const parsed = parseSdAiJson(EmailAiSectionOutputSchema, response.text)
    const built = parsed
      ? buildAiSection(parsed.section, { productId: dto.productId ?? null })
      : null
    if (!parsed || !built?.ok) {
      logger.warn('crm_email_ai.invalid_section', {
        component: 'CrmEmailAiService',
        workspaceId,
        model: call.value.model.key,
        issues: built && !built.ok ? built.error.slice(0, 3) : ['unparsable'],
      })
      return err(
        crmEmailAiFailed(
          built && !built.ok
            ? built.error[0]
            : 'A IA não devolveu uma seção válida — tente de novo',
        ),
      )
    }
    logger.info('crm_email_ai.section', {
      component: 'CrmEmailAiService',
      workspaceId,
      withProduct: Boolean(dto.productId),
      nodes: built.value.nodeCount,
      model: call.value.model.key,
    })
    return ok({
      reply: parsed.reply.trim() || 'Pronto! Arraste a seção para o e-mail.',
      fragment: built.value.fragment,
    })
  },
}
