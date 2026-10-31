import type {
  AiProcedure,
  AiProcedureRun,
  AiProcedureRunSubject,
  Prisma,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  completeMessage,
  currentStep,
  initialState,
  settle,
  submitValue,
} from '@/src/lib/ai/procedures/engine'
import {
  activeSection,
  type AvailableProcedure,
  catalogSection,
  HANDOFF_TOOL_SPEC,
  PROCEDURE_HANDOFF_TOOL,
  PROCEDURE_START_TOOL,
  PROCEDURE_TOOL_NAMES,
  startToolSpec,
  stepDirective,
  SUBMIT_TOOL_SPEC,
} from '@/src/lib/ai/procedures/prompt'
import type {
  ProcedureDefinition,
  ProcedureEvent,
  ProcedureExecutors,
  ProcedureState,
  SettleResult,
} from '@/src/lib/ai/procedures/types'
import {
  availableTools,
  resolveToolAccess,
  runReadTool,
} from '@/src/lib/ai/tools/registry'
import type { AiToolCall, AiToolSpec } from '@/src/lib/ai/types'
import { ok, type Result } from '@/src/lib/result'
import { callChatbotWebhook } from '@/src/lib/whatsapp/chatbot/webhook-call'
import { stepsOf } from '@/src/mappers/ai-procedure.mapper'
import { AiProcedureRepository } from '@/src/repositories/ai-procedure.repository'
import {
  AiProcedureRunRepository,
  type AiProcedureRunStepInput,
} from '@/src/repositories/ai-procedure-run.repository'

/**
 * Executes procedures for a conversation (WhatsApp auto-reply) or a Steel
 * Agent run (A5). One turn object wraps the model round: it contributes the
 * system section and the tools, answers the tool calls through the engine
 * and, once the model replied, decides what the customer actually receives.
 * The state lives in `ai_procedure_runs`, one RUNNING run per subject.
 * Never throws; a problem only means "no procedure this turn".
 */

/** A run untouched for this long is dropped and the next ask starts clean. */
export const PROCEDURE_STALE_MS = 24 * 60 * 60_000
export const PROCEDURE_DEFAULT_HANDOFF =
  'Vou te transferir para um de nossos atendentes, só um momento.'

export interface ProcedureSubject {
  workspaceId: string
  subjectType: AiProcedureRunSubject
  subjectId: string
  channel: 'WHATSAPP' | 'AGENT'
  agentId?: string
  /** Known from the start (`contact_name`, `contact_phone`). */
  variables?: Record<string, string>
  /** Loaded only when a procedure starts (contact data). */
  resolveVariables?: () => Promise<Record<string, string>>
  /** Test runs: reads are real, HTTP POST is not sent. */
  simulate?: boolean
  /** Mirrors each step to another trace (the Steel Agent run timeline). */
  onEvent?: (event: ProcedureEvent) => Promise<void>
}

export interface ProcedureTurnResult {
  /** What the customer receives. */
  reply: string
  /** A human must take over. */
  handoff: boolean
  handoffReason: string | null
  /** The procedure finished (any outcome) during this turn. */
  ended: boolean
}

export interface ProcedureTurn {
  /** Section to append to the system prompt (recomputed each round). */
  section(): string
  /** Tools to add to the round. */
  tools(): AiToolSpec[]
  owns(toolName: string): boolean
  handle(call: AiToolCall): Promise<string>
  finish(
    modelText: string,
    options?: { modelRequestedHandoff?: boolean },
  ): Promise<ProcedureTurnResult>
  /** The subject ended with the procedure unfinished (agent runs). */
  close(reason: string): Promise<void>
}

const json = (value: unknown) => JSON.stringify(value)
const asJson = (value: unknown) => value as Prisma.InputJsonValue

function definitionOf(
  procedure: AiProcedure,
  version: {
    whenToUse: string
    steps: unknown
    maxAttempts: number
    handoffMessage: string | null
  },
): ProcedureDefinition {
  return {
    id: procedure.id,
    name: procedure.name,
    whenToUse: version.whenToUse,
    steps: stepsOf(version.steps),
    maxAttempts: version.maxAttempts,
    handoffMessage: version.handoffMessage,
  }
}

function parseState(value: unknown, def: ProcedureDefinition): ProcedureState {
  const raw = (value ?? {}) as Partial<ProcedureState>
  const base = initialState(def, raw.variables ?? {})
  return { variables: base.variables, steps: { ...base.steps, ...raw.steps } }
}

function makeExecutors(
  subject: ProcedureSubject,
  ownerId: string | null,
): ProcedureExecutors {
  return {
    async http(request) {
      if (subject.simulate && request.method === 'POST') {
        return { ok: true, json: null }
      }
      const result = await callChatbotWebhook(request)
      return result.ok ? { ok: true, json: result.json } : result
    },
    async tool(name, args) {
      if (!ownerId) return { ok: false, reason: 'Procedimento sem responsável' }
      const access = await resolveToolAccess(ownerId, subject.workspaceId)
      if (!access.ok) return { ok: false, reason: access.error.message }
      const tool = availableTools(access.value, 'EXPLORE').find(
        (t) => t.name === name,
      )
      if (!tool) return { ok: false, reason: 'Ferramenta indisponível' }
      const result = await runReadTool(
        tool,
        {
          workspaceId: subject.workspaceId,
          actorId: ownerId,
          source: 'agent',
          ...(subject.agentId && { agentId: subject.agentId }),
        },
        args,
      )
      return result.ok
        ? { ok: true, json: result.output.data }
        : { ok: false, reason: result.error.message }
    },
  }
}

async function loadAvailable(
  subject: ProcedureSubject,
): Promise<Result<AiProcedure[]>> {
  return AiProcedureRepository.listActive(subject.workspaceId, {
    ...(subject.channel === 'WHATSAPP' && { whatsapp: true }),
    ...(subject.channel === 'AGENT' &&
      subject.agentId && { agentId: subject.agentId }),
  })
}

export const AiProcedureRuntime = {
  /**
   * Opens the procedure side of a turn. Returns `ok(null)` when there is
   * nothing to offer (no active procedure and no run in progress), so the
   * caller's behavior is untouched.
   */
  async beginTurn(
    subject: ProcedureSubject,
  ): Promise<Result<ProcedureTurn | null>> {
    if (subject.channel === 'AGENT' && !subject.agentId) return ok(null)

    let run: AiProcedureRun | null = null
    let procedure: AiProcedure | null = null
    let def: ProcedureDefinition | null = null

    const active = await AiProcedureRunRepository.findActive(
      subject.subjectType,
      subject.subjectId,
    )
    if (!active.ok) return active
    if (active.value) {
      const stale =
        Date.now() - active.value.updatedAt.getTime() > PROCEDURE_STALE_MS
      const loaded = stale
        ? null
        : await AiProcedureRepository.findById(
            active.value.procedureId,
            subject.workspaceId,
          )
      const version =
        loaded?.ok
          ? await AiProcedureRepository.findVersionByNumber(
              active.value.procedureId,
              active.value.versionNumber,
            )
          : null
      if (loaded?.ok && version?.ok && version.value) {
        run = active.value
        procedure = loaded.value
        def = definitionOf(loaded.value, version.value)
      } else {
        await AiProcedureRunRepository.save(
          active.value.id,
          {
            state: asJson(active.value.state),
            status: 'CANCELED',
            failureReason: stale ? 'Sem atividade por 24 horas' : 'Procedimento removido',
            finishedAt: new Date(),
          },
          [],
        )
      }
    }

    let available: AiProcedure[] = []
    if (!run) {
      const list = await loadAvailable(subject)
      if (!list.ok) return list
      available = list.value
      if (available.length === 0) return ok(null)
    }

    let state: ProcedureState | null = run && def ? parseState(run.state, def) : null
    let position = run
      ? await (async () => {
          const n = await AiProcedureRunRepository.countSteps(run.id)
          return n.ok ? n.value : 0
        })()
      : 0
    let status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'HANDED_OFF' | 'CANCELED' =
      'RUNNING'
    let failureReason: string | null = null
    let messages: string[] = []
    let ended = false

    const toRecord = (event: ProcedureEvent): AiProcedureRunStepInput => ({
      position: position++,
      stepKey: event.stepKey,
      kind: event.kind,
      title: event.title,
      status: event.status,
      ...(event.input !== undefined && { input: asJson(event.input) }),
      ...(event.output !== undefined && { output: asJson(event.output) }),
      error: event.error ?? null,
    })

    const persist = async (events: ProcedureEvent[]) => {
      if (!run || !state) return
      const saved = await AiProcedureRunRepository.save(
        run.id,
        {
          state: asJson(state),
          status,
          failureReason,
          ...(status !== 'RUNNING' && { finishedAt: new Date() }),
        },
        events.map(toRecord),
      )
      if (!saved.ok) {
        logger.warn(
          'ai_procedures.persist_failed',
          logFields(
            { component: 'AiProcedureRuntime', message: saved.error.message },
            { runId: run.id },
          ),
        )
      }
      for (const event of events) {
        await subject.onEvent?.(event)
      }
    }

    const apply = async (result: SettleResult, extra: ProcedureEvent[] = []) => {
      state = result.state
      messages = [...messages, ...result.messages]
      const outcome = result.outcome
      if (outcome.kind === 'completed') {
        status = 'COMPLETED'
        ended = true
      } else if (outcome.kind === 'failed') {
        status = 'FAILED'
        failureReason = outcome.reason
        ended = true
      } else if (outcome.kind === 'handoff') {
        status = 'HANDED_OFF'
        failureReason = 'Passo de transferência'
        ended = true
      }
      await persist([...extra, ...result.events])
      if (ended && run) {
        auditMutation({
          entity: 'ai_procedure_run',
          action: 'update',
          actorId: null,
          targetId: run.id,
          outcome: status === 'COMPLETED' ? 'success' : 'failure',
          meta: {
            workspaceId: subject.workspaceId,
            procedureId: run.procedureId,
            status,
            actor: 'system',
          },
        })
      }
    }

    const availableSpecs = (): AvailableProcedure[] =>
      available.map((p) => ({
        id: p.id,
        name: p.name,
        whenToUse: p.whenToUse,
      }))

    const directive = () => {
      const step = def && state ? currentStep(def, state) : null
      return {
        passo_atual: step?.title ?? null,
        instrucao: stepDirective(step),
        enviado_automaticamente_ao_cliente: messages,
        aviso:
          messages.length > 0
            ? 'O sistema envia essas mensagens sozinho; não as repita.'
            : undefined,
      }
    }

    const turn: ProcedureTurn = {
      section() {
        if (run && def && state && !ended) return activeSection(def, state)
        if (!run && available.length > 0) {
          return catalogSection(availableSpecs())
        }
        return ''
      },

      tools() {
        if (ended) return []
        if (!run) return [startToolSpec(availableSpecs())]
        const specs: AiToolSpec[] = []
        const step = def && state ? currentStep(def, state) : null
        if (step?.kind === 'COLLECT') specs.push(SUBMIT_TOOL_SPEC)
        specs.push(HANDOFF_TOOL_SPEC)
        return specs
      },

      owns(name) {
        return PROCEDURE_TOOL_NAMES.includes(name)
      },

      async handle(call) {
        if (call.name === PROCEDURE_START_TOOL) {
          if (run || ended) {
            return json({
              status: 'erro',
              erro: 'Já existe um procedimento em andamento ou encerrado neste turno.',
            })
          }
          const id = String(call.arguments.procedimento ?? '')
          const chosen = available.find((p) => p.id === id)
          if (!chosen) {
            return json({ status: 'erro', erro: 'Procedimento inexistente.' })
          }
          const version = await AiProcedureRepository.findVersionByNumber(
            chosen.id,
            chosen.currentVersion,
          )
          if (!version.ok || !version.value) {
            return json({ status: 'erro', erro: 'Procedimento indisponível.' })
          }
          procedure = chosen
          def = definitionOf(chosen, version.value)
          state = initialState(def, {
            ...subject.variables,
            ...(await subject.resolveVariables?.()),
          })
          const created = await AiProcedureRunRepository.create({
            workspaceId: subject.workspaceId,
            procedureId: chosen.id,
            versionNumber: chosen.currentVersion,
            subjectType: subject.subjectType,
            subjectId: subject.subjectId,
            state: asJson(state),
          })
          if (!created.ok) {
            return json({ status: 'erro', erro: 'Falha ao iniciar.' })
          }
          run = created.value
          const startEvent: ProcedureEvent = {
            stepKey: '_start',
            kind: 'GUARD',
            title: `Procedimento iniciado: ${chosen.name}`,
            status: 'OK',
            output: { versionNumber: chosen.currentVersion },
          }
          await apply(
            await settle(def, state, makeExecutors(subject, chosen.ownerId)),
            [startEvent],
          )
          return json({ status: ended ? 'encerrado' : 'iniciado', ...directive() })
        }

        if (!run || !def || !state || ended) {
          return json({ status: 'erro', erro: 'Nenhum procedimento em andamento.' })
        }

        if (call.name === PROCEDURE_HANDOFF_TOOL) {
          status = 'HANDED_OFF'
          failureReason = String(call.arguments.motivo ?? 'Pedido da IA')
          ended = true
          await persist([
            {
              stepKey: '_handoff',
              kind: 'GUARD',
              title: 'IA transferiu para um humano',
              status: 'OK',
              output: { reason: failureReason },
            },
          ])
          return json({ status: 'transferir' })
        }

        // PROCEDURE_SUBMIT_TOOL
        const variable = String(call.arguments.variavel ?? '')
        const value = String(call.arguments.valor ?? '')
        const submitted = submitValue(def, state, variable, value)
        if (!submitted.ok) {
          state = submitted.state
          if (submitted.failed) {
            status = 'FAILED'
            failureReason = submitted.failed.reason
            ended = true
          }
          await persist(submitted.events)
          return json({
            status: 'erro',
            erro:
              submitted.reason === 'out_of_order'
                ? 'Passo fora de ordem: execute apenas o passo atual.'
                : submitted.reason === 'invalid'
                  ? 'Valor inválido. Peça ao cliente para conferir e informar de novo.'
                  : 'Nenhum passo pendente.',
            tentativas_restantes: submitted.attemptsLeft,
            ...(ended ? { status: 'transferir' } : directive()),
          })
        }
        state = submitted.state
        await apply(
          await settle(def, state, makeExecutors(subject, procedure?.ownerId ?? null)),
          submitted.events,
        )
        return json({
          status: ended ? 'encerrado' : 'ok',
          ...directive(),
        })
      },

      async close(reason) {
        if (!run || ended) return
        status = 'CANCELED'
        failureReason = reason
        ended = true
        await persist([])
      },

      async finish(modelText, options) {
        const text = modelText.trim()
        if (run && def && state && !ended) {
          if (options?.modelRequestedHandoff) {
            status = 'HANDED_OFF'
            failureReason = 'Transferência pedida pela IA'
            ended = true
            await persist([])
          } else if (text) {
            const done = completeMessage(def, state, text)
            if (done.events.length > 0) {
              state = done.state
              await apply(
                await settle(
                  def,
                  state,
                  makeExecutors(subject, procedure?.ownerId ?? null),
                ),
                done.events,
              )
            }
          }
        }

        const handedOff = status === 'FAILED' || status === 'HANDED_OFF'
        if (!run) {
          return { reply: text, handoff: false, handoffReason: null, ended: false }
        }
        if (handedOff) {
          const reply =
            messages.join('\n\n') ||
            def?.handoffMessage ||
            PROCEDURE_DEFAULT_HANDOFF
          return {
            reply,
            handoff: true,
            handoffReason: failureReason,
            ended: true,
          }
        }
        if (status === 'COMPLETED') {
          return {
            reply: messages.join('\n\n') || text,
            handoff: false,
            handoffReason: null,
            ended: true,
          }
        }
        return {
          reply: [...messages, text].filter(Boolean).join('\n\n'),
          handoff: false,
          handoffReason: null,
          ended: false,
        }
      },
    }
    return ok(turn)
  },
}
