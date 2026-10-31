import type { AiToolSpec } from '@/src/lib/ai/types'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'
import { currentStep } from './engine'
import type { ProcedureDefinition, ProcedureState } from './types'

export const PROCEDURE_START_TOOL = 'procedimento_iniciar'
export const PROCEDURE_SUBMIT_TOOL = 'procedimento_registrar'
export const PROCEDURE_HANDOFF_TOOL = 'procedimento_transferir'
export const PROCEDURE_TOOL_NAMES: readonly string[] = [
  PROCEDURE_START_TOOL,
  PROCEDURE_SUBMIT_TOOL,
  PROCEDURE_HANDOFF_TOOL,
]

export interface AvailableProcedure {
  id: string
  name: string
  whenToUse: string
}

/** System-prompt section when no procedure is running. */
export function catalogSection(procedures: AvailableProcedure[]): string {
  const lines = procedures.map(
    (procedure) =>
      `- ${procedure.id} — ${procedure.name}: ${procedure.whenToUse}`,
  )
  return `\n\nProcedimentos disponíveis (roteiros com passos obrigatórios):\n${lines.join('\n')}\nQuando o pedido do cliente corresponder a um deles, chame ${PROCEDURE_START_TOOL} com o id. A partir daí o sistema conduz os passos; você não pode pular nem reordenar nenhum.`
}

function statusMark(status: string, current: boolean): string {
  if (current) return '▶'
  if (status === 'DONE') return '✓'
  if (status === 'SKIPPED') return '–'
  if (status === 'FAILED') return '✗'
  return '○'
}

/** What to do at the current step, for the model. */
export function stepDirective(step: ProcedureStep | null): string {
  if (!step) return 'Todos os passos foram concluídos.'
  switch (step.kind) {
    case 'COLLECT':
      return `Peça ao cliente: ${step.prompt}. Quando ele informar o valor, chame ${PROCEDURE_SUBMIT_TOOL} com variavel="${step.variable}" e o valor exato que o cliente escreveu. Não invente valores.`
    case 'MESSAGE':
      return `Escreva ao cliente: ${step.instruction ?? ''}`
    default:
      return 'O sistema executa este passo sozinho.'
  }
}

/** System-prompt section while a procedure runs. */
export function activeSection(
  definition: ProcedureDefinition,
  state: ProcedureState,
): string {
  const current = currentStep(definition, state)
  const list = definition.steps
    .map((step) => {
      const progress = state.steps[step.key]?.status ?? 'PENDING'
      return `${statusMark(progress, current?.key === step.key)} ${step.title}`
    })
    .join('\n')
  return `\n\nPROCEDIMENTO EM ANDAMENTO: ${definition.name}\nPassos (✓ feito, ▶ atual, ○ pendente, – dispensado):\n${list}\n\nPasso atual: ${current ? current.title : 'nenhum'}.\n${stepDirective(current)}\nRegras: execute somente o passo atual, na ordem; não pule, não reordene e não diga que algo foi feito antes de o sistema confirmar. Se não conseguir ajudar, chame ${PROCEDURE_HANDOFF_TOOL}.`
}

export function startToolSpec(procedures: AvailableProcedure[]): AiToolSpec {
  return {
    name: PROCEDURE_START_TOOL,
    description:
      'Inicia um procedimento (roteiro com passos obrigatórios) para a conversa atual.',
    parameters: {
      type: 'object',
      properties: {
        procedimento: {
          type: 'string',
          enum: procedures.map((procedure) => procedure.id),
        },
      },
      required: ['procedimento'],
      additionalProperties: false,
    },
  }
}

export const SUBMIT_TOOL_SPEC: AiToolSpec = {
  name: PROCEDURE_SUBMIT_TOOL,
  description:
    'Entrega ao procedimento o valor que o cliente informou para o passo atual. O sistema valida; valores inválidos são recusados.',
  parameters: {
    type: 'object',
    properties: {
      variavel: { type: 'string' },
      valor: { type: 'string' },
    },
    required: ['variavel', 'valor'],
    additionalProperties: false,
  },
}

export const HANDOFF_TOOL_SPEC: AiToolSpec = {
  name: PROCEDURE_HANDOFF_TOOL,
  description:
    'Encerra o procedimento e passa a conversa para um atendente humano.',
  parameters: {
    type: 'object',
    properties: { motivo: { type: 'string' } },
    additionalProperties: false,
  },
}
