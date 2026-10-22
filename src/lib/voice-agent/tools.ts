import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  type AiToolAccess,
  aiActionSource,
  findTool,
  hasToolAccess,
  resolveToolAccess,
  runTool,
} from '@/src/lib/ai/tools/registry'
import type { AiToolContext } from '@/src/lib/ai/tools/types'
import { phoneMatchKey } from '@/src/lib/pabx/recording'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { VoiceAgentRepository } from '@/src/repositories/voice-agent.repository'
import { SdTicketService } from '@/src/services/sd-ticket.service'
import type { VoiceToolExecutor, VoiceToolRun } from './bridge'
import type { VoiceToolCall, VoiceToolDefinition } from './provider'

/** What the tools learned during the call (read by the session runner). */
export interface VoiceCallState {
  contactName: string | null
  ticket: { id: string; code: string } | null
  handoffSummary: string | null
  /** Title shown to the caller in the preview step, normalized. */
  previewedTitle: string | null
}

export interface VoiceToolsInput {
  workspaceId: string
  /** Identity the attendant acts as (same RBAC as any Steel AI tool). */
  runAsUserId: string
  callId: string
  callerNumber: string
  canOpenTickets: boolean
  canLookupTickets: boolean
  /** Route override of the human destination. */
  transferTarget: string | null
  /** Tickets looked up in one call at most (abuse guard). */
  maxLookups?: number
}

export const VOICE_TOOL_NAMES = {
  identify: 'identify_contact',
  open: 'open_ticket',
  status: 'ticket_status',
  transfer: 'transfer_to_human',
} as const

const MAX_LOOKUPS = 5
const STATUS_TICKETS_WITHOUT_NUMBER = 3
const PRACTICES = ['incident', 'request'] as const

/** Safe wording the model can say when something fails. */
function failure(message: string): VoiceToolRun {
  return { output: JSON.stringify({ status: 'error', message }) }
}

function json(value: unknown): VoiceToolRun {
  return { output: JSON.stringify(value) }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Tools of the voice attendant (ADR 0046). They go through the Steel AI
 * registry with the run-as identity: `sd_create_ticket` and
 * `zap_contacts_search` are the registry's own tools; the ticket status
 * lookup is narrower than `sd_get_ticket` on purpose, because the caller is
 * not authenticated and may only ever hear about their own tickets.
 */
export async function createVoiceTools(input: VoiceToolsInput): Promise<{
  definitions: VoiceToolDefinition[]
  executor: VoiceToolExecutor
  state: VoiceCallState
}> {
  const state: VoiceCallState = {
    contactName: null,
    ticket: null,
    handoffSummary: null,
    previewedTitle: null,
  }
  const ctx: AiToolContext = {
    workspaceId: input.workspaceId,
    actorId: input.runAsUserId,
    source: 'voice',
  }

  const resolved = await resolveToolAccess(input.runAsUserId, input.workspaceId)
  const access: AiToolAccess | null =
    resolved.ok && resolved.value.aiEnabled ? resolved.value : null

  const createTool = findTool('sd_create_ticket')
  const searchTool = findTool('zap_contacts_search')
  const callerKey = phoneMatchKey(input.callerNumber)
  const maxLookups = input.maxLookups ?? MAX_LOOKUPS

  const allowed = (tool: ReturnType<typeof findTool>) =>
    Boolean(tool && access && hasToolAccess(tool, access))

  const canIdentify = allowed(searchTool)
  const canOpen = input.canOpenTickets && allowed(createTool)
  const canStatus = input.canLookupTickets && access !== null

  const definitions: VoiceToolDefinition[] = []
  if (canIdentify) {
    definitions.push({
      name: VOICE_TOOL_NAMES.identify,
      description:
        'Descobre se quem está ligando já é um contato conhecido, pelo número da própria ligação. Não recebe argumentos. Devolve o nome quando conhecido.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    })
  }
  if (canOpen) {
    definitions.push({
      name: VOICE_TOOL_NAMES.open,
      description:
        'Abre um chamado com o que o cliente relatou. Chame primeiro sem `confirmed` para receber a prévia que você lê ao cliente; só chame de novo com `confirmed` verdadeiro, e os mesmos título e descrição, depois de ele dizer sim. No máximo um chamado por ligação.',
      parameters: {
        type: 'object',
        properties: {
          practice: {
            type: 'string',
            enum: [...PRACTICES],
            description:
              'incident: algo parou de funcionar; request: um pedido ou dúvida de serviço.',
          },
          title: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          confirmed: { type: 'boolean' },
        },
        required: ['practice', 'title'],
        additionalProperties: false,
      },
    })
  }
  if (canStatus) {
    definitions.push({
      name: VOICE_TOOL_NAMES.status,
      description:
        'Informa a situação de chamados do próprio cliente. `ticket` é o número ou código que ele disse (ex.: 123 ou INC-000123); sem ele, devolve os mais recentes.',
      parameters: {
        type: 'object',
        properties: { ticket: { type: 'string', maxLength: 40 } },
        additionalProperties: false,
      },
    })
  }
  definitions.push({
    name: VOICE_TOOL_NAMES.transfer,
    description:
      'Passa a ligação para uma pessoa. `reason` diz por que; `summary` é um resumo curto do que o cliente precisa, que a pessoa lê antes de atender.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 200 },
        summary: { type: 'string', maxLength: 600 },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  })

  let lookups = 0

  async function identify(): Promise<VoiceToolRun> {
    if (!canIdentify || !searchTool || !callerKey) {
      return json({ known: false })
    }
    const digits = input.callerNumber.replace(/\D/g, '')
    const run = await runTool(searchTool, ctx, { query: digits.slice(-8) })
    if (!run.ok) return json({ known: false })
    const items =
      (run.output.data as { items?: { name: string | null; waId: string }[] })
        .items ?? []
    const match = items.find((item) => phoneMatchKey(item.waId) === callerKey)
    state.contactName = match?.name ?? null
    return json({ known: Boolean(match), name: match?.name ?? null })
  }

  async function openTicket(
    call: VoiceToolCall,
    tainted: boolean,
  ): Promise<VoiceToolRun> {
    if (!canOpen || !createTool)
      return failure('Abrir chamado não está disponível.')
    if (state.ticket) {
      return failure(
        `Já foi aberto o chamado ${state.ticket.code} nesta ligação.`,
      )
    }
    if (tainted) {
      return failure(
        'Não posso abrir chamado por aqui. Transfira o cliente para uma pessoa.',
      )
    }
    const title = text(call.args.title, 200)
    if (!title) return failure('Falta o título do chamado.')
    const description = text(call.args.description, 2000)
    const args = {
      practice: call.args.practice,
      title,
      description: `${description ? `${description}\n\n` : ''}Chamado aberto pelo atendente de voz. Telefone de quem ligou: ${input.callerNumber}.`,
    }
    const parsed = createTool.parse(args)
    if (!parsed.ok) return failure('Os dados do chamado estão incompletos.')

    const confirmed =
      call.args.confirmed === true &&
      state.previewedTitle === normalizeTitle(title)
    if (!confirmed) {
      const preview = createTool.preview
        ? await createTool.preview(ctx, parsed.value)
        : null
      if (preview && !preview.ok) {
        return failure('Não consegui preparar o chamado. Transfira o cliente.')
      }
      state.previewedTitle = normalizeTitle(title)
      return json({
        status: 'needs_confirmation',
        message:
          'Leia ao cliente o que será aberto e só chame de novo com confirmed=true depois de ele dizer sim.',
        preview: preview?.ok
          ? {
              title: preview.value.title,
              fields: preview.value.fields?.map((field) => ({
                label: field.label,
                value: field.after,
              })),
            }
          : { title },
      })
    }

    const run = await runTool(createTool, ctx, args)
    const target = run.ok ? run.output.target : undefined
    await AiActionLogRepository.create({
      workspaceId: input.workspaceId,
      source: aiActionSource(ctx),
      actorId: input.runAsUserId,
      toolName: createTool.name,
      kind: 'CREATE',
      module: createTool.module,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      args: {
        title,
        practice: String(call.args.practice),
      } as Prisma.InputJsonValue,
      outcome: run.ok ? 'success' : 'failure',
      summary: run.ok ? run.output.summary : null,
      error: run.ok ? null : run.error.message,
    })
    auditMutation({
      entity: 'whatsapp_phone_call',
      action: 'voice_ticket',
      actorId: input.runAsUserId,
      targetId: input.callId,
      outcome: run.ok ? 'success' : 'failure',
      ...(!run.ok && { reason: run.error.code }),
      meta: { workspaceId: input.workspaceId, ticketId: target?.id },
    })
    if (!run.ok || !target) {
      logger.warn('voice_agent.ticket_failed', {
        component: 'VoiceAgentTools',
        workspaceId: input.workspaceId,
        callId: input.callId,
        code: run.ok ? 'no_target' : run.error.code,
      })
      return failure('Não consegui abrir o chamado agora. Transfira o cliente.')
    }
    state.ticket = { id: target.id, code: target.label ?? target.id }
    return json({ status: 'done', ticket: state.ticket.code })
  }

  async function ticketStatus(call: VoiceToolCall): Promise<VoiceToolRun> {
    if (!canStatus) return failure('Consulta de chamado não está disponível.')
    if (lookups >= maxLookups) {
      return failure('Muitas consultas nesta ligação. Transfira o cliente.')
    }
    lookups++
    if (!callerKey) return json({ status: 'not_found' })

    const owned = await VoiceAgentRepository.findTicketIdsForCaller(
      input.workspaceId,
      callerKey,
    )
    if (!owned.ok) return failure('Não consegui consultar agora.')

    const asked = text(call.args.ticket, 40)
    const askedNumber = Number(asked.match(/(\d+)\s*$/)?.[1])
    const candidates = asked
      ? owned.value.filter((ticket) => ticket.number === askedNumber)
      : owned.value.slice(0, STATUS_TICKETS_WITHOUT_NUMBER)
    if (candidates.length === 0) return json({ status: 'not_found' })

    const tickets = []
    for (const candidate of candidates) {
      const found = await SdTicketService.get(
        input.runAsUserId,
        input.workspaceId,
        candidate.id,
      )
      if (!found.ok) continue
      const ticket = found.value
      tickets.push({
        code: ticket.code,
        title: ticket.title,
        phase: ticket.phase.name,
        priority: ticket.priority?.name ?? null,
        resolutionDueAt: ticket.resolutionDueAt,
      })
    }
    return tickets.length === 0
      ? json({ status: 'not_found' })
      : json({ status: 'found', tickets })
  }

  function transfer(call: VoiceToolCall): VoiceToolRun {
    const reason = text(call.args.reason, 200) || 'pedido do cliente'
    const summary = text(call.args.summary, 600)
    if (summary) state.handoffSummary = summary
    return {
      output: JSON.stringify({ status: 'transferring' }),
      transfer: { reason, target: input.transferTarget },
    }
  }

  const executor: VoiceToolExecutor = {
    async execute(call, context) {
      switch (call.name) {
        case VOICE_TOOL_NAMES.identify:
          return identify()
        case VOICE_TOOL_NAMES.open:
          return openTicket(call, context.tainted)
        case VOICE_TOOL_NAMES.status:
          return ticketStatus(call)
        case VOICE_TOOL_NAMES.transfer:
          return transfer(call)
        default:
          return failure('Ferramenta desconhecida.')
      }
    },
  }

  return { definitions, executor, state }
}
