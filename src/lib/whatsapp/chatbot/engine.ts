import {
  CHATBOT_LIMITS,
  type ChatbotFlow,
  type ChatbotNode,
  type ChatbotNodeOf,
} from '@/src/schemas/whatsapp-chatbot.schema'
import {
  checkAnswer,
  evaluateCondition,
  interpolate,
  interpolateJson,
  normalizeAnswer,
  readPath,
} from './text'

/**
 * Pure chatbot engine (Z2). It walks the flow graph, collects what must be
 * sent and says where the run stopped; it never touches the database or the
 * provider. The runtime service owns the I/O and calls `startFlow` for a new
 * session and `resumeFlow` for each answer of the contact.
 */

/** Hard stop for nodes visited in one run (loops without a wait). */
export const CHATBOT_MAX_STEPS = 40

export const MENU_BUTTON_PREFIX = 'bot'

export type ChatbotAwaiting =
  | { kind: 'menu'; nodeId: string; attempts: number }
  | { kind: 'question'; nodeId: string; attempts: number }

export interface ChatbotState {
  started: boolean
  awaiting: ChatbotAwaiting | null
  variables: Record<string, string>
}

export function initialChatbotState(): ChatbotState {
  return { started: false, awaiting: null, variables: {} }
}

/** Defensive read of the `state` JSON column. */
export function parseChatbotState(value: unknown): ChatbotState {
  if (!value || typeof value !== 'object') return initialChatbotState()
  const raw = value as Partial<ChatbotState>
  const awaiting = raw.awaiting
  const validAwaiting =
    awaiting &&
    (awaiting.kind === 'menu' || awaiting.kind === 'question') &&
    typeof awaiting.nodeId === 'string' &&
    typeof awaiting.attempts === 'number'
      ? awaiting
      : null
  const variables: Record<string, string> = {}
  if (raw.variables && typeof raw.variables === 'object') {
    for (const [key, item] of Object.entries(raw.variables)) {
      if (typeof item === 'string') variables[key] = item
    }
  }
  return {
    started: raw.started === true,
    awaiting: validAwaiting,
    variables,
  }
}

export interface ChatbotButtonOutput {
  id: string
  label: string
}

export type ChatbotOutput =
  | { kind: 'text'; text: string }
  | {
      kind: 'menu'
      nodeId: string
      text: string
      /** Set when the menu fits reply buttons (up to 3, short labels). */
      buttons: ChatbotButtonOutput[] | null
      /** Same menu as numbered text — also the fallback for buttons. */
      numbered: string
    }

export type ChatbotRunStatus =
  | 'WAITING'
  | 'COMPLETED'
  | 'HANDED_OFF_HUMAN'
  | 'HANDED_OFF_AI'
  | 'FAILED'

export interface ChatbotHandoff {
  teamId?: string
  userId?: string
  instruction?: string
  /** Why the flow handed off without an explicit handoff node. */
  reason?: string
}

export interface ChatbotRunResult {
  state: ChatbotState
  outputs: ChatbotOutput[]
  status: ChatbotRunStatus
  /** Present for HANDED_OFF_* (and FAILED, which falls back to a person). */
  handoff?: ChatbotHandoff
  closeConversation?: boolean
  endReason?: string
}

export interface ChatbotWebhookRequest {
  url: string
  method: 'GET' | 'POST'
  body: unknown
}

export type ChatbotWebhookResponse =
  | { ok: true; json: unknown }
  | { ok: false; reason: string }

export interface ChatbotContext {
  contact: { name: string | null; phone: string }
  callWebhook: (
    request: ChatbotWebhookRequest,
  ) => Promise<ChatbotWebhookResponse>
}

export interface ChatbotInput {
  text: string
  /** Raw payload/id of a tapped button, when the message was a click. */
  buttonPayload?: string
}

function nodeById(flow: ChatbotFlow, id: string): ChatbotNode | undefined {
  return flow.nodes.find((node) => node.id === id)
}

function targetOf(
  flow: ChatbotFlow,
  source: string,
  handle: string,
): string | null {
  const edge = flow.edges.find(
    (item) => item.source === source && item.sourceHandle === handle,
  )
  return edge?.target ?? null
}

export function menuButtonPayload(nodeId: string, optionId: string): string {
  return `${MENU_BUTTON_PREFIX}:${nodeId}:${optionId}`
}

function numberedMenu(node: ChatbotNodeOf<'menu'>, text: string): string {
  const lines = node.data.options.map(
    (option, index) => `${index + 1}. ${option.label}`,
  )
  return `${text}\n\n${lines.join('\n')}\n\nResponda com o número ou com o nome da opção.`
}

function renderMenu(
  node: ChatbotNodeOf<'menu'>,
  variables: Record<string, string>,
): ChatbotOutput {
  const text = interpolate(node.data.text, variables)
  const fitsButtons =
    node.data.options.length <= CHATBOT_LIMITS.menuButtonsMax &&
    node.data.options.every(
      (option) => option.label.length <= CHATBOT_LIMITS.menuButtonLabelMax,
    )
  return {
    kind: 'menu',
    nodeId: node.id,
    text,
    buttons: fitsButtons
      ? node.data.options.map((option) => ({
          id: menuButtonPayload(node.id, option.id),
          label: option.label,
        }))
      : null,
    numbered: numberedMenu(node, text),
  }
}

/** The option a menu answer points to, or `null` when it is not understood. */
export function matchMenuOption(
  node: ChatbotNodeOf<'menu'>,
  input: ChatbotInput,
): ChatbotNodeOf<'menu'>['data']['options'][number] | null {
  const { options } = node.data
  if (input.buttonPayload) {
    const [prefix, nodeId, optionId] = input.buttonPayload.split(':')
    if (prefix === MENU_BUTTON_PREFIX && nodeId === node.id) {
      const byPayload = options.find((option) => option.id === optionId)
      if (byPayload) return byPayload
    }
  }
  const answer = normalizeAnswer(input.text)
  if (!answer) return null
  if (/^\d{1,2}$/.test(answer)) {
    const byNumber = options[Number(answer) - 1]
    if (byNumber) return byNumber
  }
  return (
    options.find((option) => normalizeAnswer(option.label) === answer) ?? null
  )
}

interface Run {
  flow: ChatbotFlow
  ctx: ChatbotContext
  variables: Record<string, string>
  outputs: ChatbotOutput[]
  steps: number
}

type Step =
  | { kind: 'goto'; nodeId: string | null }
  | { kind: 'wait'; awaiting: ChatbotAwaiting }
  | {
      kind: 'stop'
      status: Exclude<ChatbotRunStatus, 'WAITING'>
      handoff?: ChatbotHandoff
      closeConversation?: boolean
      endReason?: string
    }

function pushText(run: Run, text: string | undefined) {
  const rendered = text ? interpolate(text, run.variables).trim() : ''
  if (rendered) run.outputs.push({ kind: 'text', text: rendered })
}

async function visit(run: Run, node: ChatbotNode): Promise<Step> {
  const { flow, variables } = run
  switch (node.type) {
    case 'start':
      return { kind: 'goto', nodeId: targetOf(flow, node.id, 'next') }
    case 'message':
      pushText(run, node.data.text)
      return { kind: 'goto', nodeId: targetOf(flow, node.id, 'next') }
    case 'menu':
      run.outputs.push(renderMenu(node, variables))
      return {
        kind: 'wait',
        awaiting: { kind: 'menu', nodeId: node.id, attempts: 0 },
      }
    case 'question':
      pushText(run, node.data.text)
      return {
        kind: 'wait',
        awaiting: { kind: 'question', nodeId: node.id, attempts: 0 },
      }
    case 'set-variable':
      variables[node.data.variable] = interpolate(node.data.value, variables)
      return { kind: 'goto', nodeId: targetOf(flow, node.id, 'next') }
    case 'condition': {
      const hit = node.data.branches.find((branch) =>
        evaluateCondition(
          branch.operator,
          variables[branch.variable] ?? '',
          interpolate(branch.value, variables),
        ),
      )
      return {
        kind: 'goto',
        nodeId: targetOf(flow, node.id, hit ? hit.id : 'else'),
      }
    }
    case 'webhook': {
      const response = await run.ctx.callWebhook({
        url: interpolate(node.data.url, variables),
        method: node.data.method,
        body:
          node.data.method === 'POST' && node.data.body
            ? interpolateJson(node.data.body, variables)
            : undefined,
      })
      if (!response.ok) {
        const onError = targetOf(flow, node.id, 'error')
        return {
          kind: 'goto',
          nodeId: onError ?? targetOf(flow, node.id, 'next'),
        }
      }
      if (node.data.responseVariable && node.data.responsePath) {
        const found = readPath(response.json, node.data.responsePath)
        variables[node.data.responseVariable] = found ?? ''
      }
      return { kind: 'goto', nodeId: targetOf(flow, node.id, 'next') }
    }
    case 'handoff-human':
      pushText(run, node.data.text)
      return {
        kind: 'stop',
        status: 'HANDED_OFF_HUMAN',
        handoff: { teamId: node.data.teamId, userId: node.data.userId },
        endReason: 'handoff_human',
      }
    case 'handoff-ai':
      pushText(run, node.data.text)
      return {
        kind: 'stop',
        status: 'HANDED_OFF_AI',
        handoff: { instruction: node.data.instruction },
        endReason: 'handoff_ai',
      }
    case 'end':
      pushText(run, node.data.text)
      return {
        kind: 'stop',
        status: 'COMPLETED',
        closeConversation: node.data.closeConversation,
        endReason: 'end_node',
      }
  }
}

function finish(
  run: Run,
  step: Step,
  awaiting: ChatbotAwaiting | null,
): ChatbotRunResult {
  const state: ChatbotState = {
    started: true,
    awaiting,
    variables: run.variables,
  }
  if (step.kind === 'wait') {
    return { state, outputs: run.outputs, status: 'WAITING' }
  }
  if (step.kind === 'stop') {
    return {
      state,
      outputs: run.outputs,
      status: step.status,
      handoff: step.handoff,
      closeConversation: step.closeConversation,
      endReason: step.endReason,
    }
  }
  return {
    state,
    outputs: run.outputs,
    status: 'COMPLETED',
    endReason: 'flow_ended',
  }
}

async function walk(run: Run, from: string | null): Promise<ChatbotRunResult> {
  let cursor = from
  while (cursor) {
    run.steps += 1
    if (run.steps > CHATBOT_MAX_STEPS) {
      return {
        state: { started: true, awaiting: null, variables: run.variables },
        outputs: run.outputs,
        status: 'FAILED',
        handoff: { reason: 'loop_guard' },
        endReason: 'loop_guard',
      }
    }
    const node = nodeById(run.flow, cursor)
    if (!node) {
      return {
        state: { started: true, awaiting: null, variables: run.variables },
        outputs: run.outputs,
        status: 'FAILED',
        handoff: { reason: 'missing_node' },
        endReason: 'missing_node',
      }
    }
    const step = await visit(run, node)
    if (step.kind === 'goto') {
      cursor = step.nodeId
      continue
    }
    return finish(run, step, step.kind === 'wait' ? step.awaiting : null)
  }
  return finish(run, { kind: 'goto', nodeId: null }, null)
}

function seedVariables(
  ctx: ChatbotContext,
  variables: Record<string, string>,
  input?: ChatbotInput,
): Record<string, string> {
  return {
    ...variables,
    contact_name: ctx.contact.name ?? '',
    contact_phone: ctx.contact.phone,
    ...(input ? { last_message: input.text } : {}),
  }
}

/** Starts a flow at its `start` node. */
export async function startFlow(
  flow: ChatbotFlow,
  ctx: ChatbotContext,
  input?: ChatbotInput,
): Promise<ChatbotRunResult> {
  const start = flow.nodes.find((node) => node.type === 'start')
  const run: Run = {
    flow,
    ctx,
    variables: seedVariables(ctx, {}, input),
    outputs: [],
    steps: 0,
  }
  if (!start) {
    return {
      state: { started: true, awaiting: null, variables: run.variables },
      outputs: [],
      status: 'FAILED',
      handoff: { reason: 'missing_start' },
      endReason: 'missing_start',
    }
  }
  return walk(run, start.id)
}

function invalidAnswer(
  run: Run,
  node: ChatbotNodeOf<'menu'> | ChatbotNodeOf<'question'>,
  pending: ChatbotAwaiting,
  retryText: string,
): Promise<ChatbotRunResult> | ChatbotRunResult {
  const attempts = pending.attempts + 1
  if (attempts >= node.data.maxAttempts) {
    const target = targetOf(run.flow, node.id, 'invalid')
    if (target) return walk(run, target)
    // No "invalid" exit drawn: a person takes over instead of looping.
    pushText(
      run,
      'Não consegui entender. Vou chamar um atendente para ajudar você.',
    )
    return {
      state: { started: true, awaiting: null, variables: run.variables },
      outputs: run.outputs,
      status: 'HANDED_OFF_HUMAN',
      handoff: { reason: 'invalid_answer' },
      endReason: 'invalid_answer',
    }
  }
  pushText(run, retryText)
  if (node.type === 'menu') run.outputs.push(renderMenu(node, run.variables))
  const awaiting: ChatbotAwaiting = {
    kind: node.type === 'menu' ? 'menu' : 'question',
    nodeId: node.id,
    attempts,
  }
  return {
    state: { started: true, awaiting, variables: run.variables },
    outputs: run.outputs,
    status: 'WAITING',
  }
}

/** Feeds the contact's answer to the node the session is waiting on. */
export async function resumeFlow(
  flow: ChatbotFlow,
  state: ChatbotState,
  input: ChatbotInput,
  ctx: ChatbotContext,
): Promise<ChatbotRunResult> {
  const run: Run = {
    flow,
    ctx,
    variables: seedVariables(ctx, state.variables, input),
    outputs: [],
    steps: 0,
  }
  const awaiting = state.awaiting
  const node = awaiting ? nodeById(flow, awaiting.nodeId) : undefined
  if (!awaiting || !node) {
    return {
      state: { started: true, awaiting: null, variables: run.variables },
      outputs: [],
      status: 'FAILED',
      handoff: { reason: 'missing_node' },
      endReason: 'missing_node',
    }
  }

  if (node.type === 'menu') {
    const option = matchMenuOption(node, input)
    if (!option) {
      return invalidAnswer(
        run,
        node,
        awaiting,
        'Não entendi sua resposta. Escolha uma das opções abaixo.',
      )
    }
    if (node.data.variable) run.variables[node.data.variable] = option.label
    return walk(run, targetOf(flow, node.id, option.id))
  }

  if (node.type === 'question') {
    const checked = checkAnswer(node.data.validation, input.text)
    if (!checked.ok) {
      return invalidAnswer(
        run,
        node,
        awaiting,
        node.data.errorText ??
          'Não consegui entender essa resposta. Pode enviar de novo?',
      )
    }
    run.variables[node.data.variable] = checked.value
    return walk(run, targetOf(flow, node.id, 'next'))
  }

  return {
    state: { started: true, awaiting: null, variables: run.variables },
    outputs: [],
    status: 'FAILED',
    handoff: { reason: 'invalid_state' },
    endReason: 'invalid_state',
  }
}
