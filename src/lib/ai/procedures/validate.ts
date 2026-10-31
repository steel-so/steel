import {
  PROCEDURE_LIMITS,
  PROCEDURE_PRESET_VARIABLES,
  type ProcedureStep,
} from '@/src/schemas/ai-procedure.schema'

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g

function placeholdersOf(...texts: (string | undefined)[]): string[] {
  const names: string[] = []
  for (const text of texts) {
    if (!text) continue
    for (const match of text.matchAll(PLACEHOLDER)) names.push(match[1])
  }
  return names
}

function textsOf(step: ProcedureStep): (string | undefined)[] {
  switch (step.kind) {
    case 'HTTP':
      return [step.url, step.body]
    case 'TOOL':
      return Object.values(step.args)
    case 'MESSAGE':
      return [step.text, step.instruction]
    case 'HANDOFF':
      return [step.text]
    default:
      return []
  }
}

/** Variables a step makes available to the ones after it. */
export function variablesDefinedBy(step: ProcedureStep): string[] {
  if (step.kind === 'COLLECT') return [step.variable]
  if (step.kind === 'HTTP' || step.kind === 'TOOL') {
    return step.saves.map((save) => save.variable)
  }
  return []
}

/**
 * Structural checks the Zod schema cannot do: unique keys, variables used
 * only after something defines them, a message that says something.
 * Returns pt-BR problems; empty = runnable.
 */
export function procedureProblems(steps: readonly ProcedureStep[]): string[] {
  const problems: string[] = []
  const keys = new Set<string>()
  const known = new Set<string>(PROCEDURE_PRESET_VARIABLES)
  if (steps.length === 0) problems.push('O procedimento precisa de passos')
  if (steps.length > PROCEDURE_LIMITS.steps) {
    problems.push(`No máximo ${PROCEDURE_LIMITS.steps} passos`)
  }

  steps.forEach((step, index) => {
    const label = `Passo ${index + 1} ("${step.title}")`
    if (keys.has(step.key)) problems.push(`${label}: chave repetida`)
    keys.add(step.key)

    if (step.condition && !known.has(step.condition.variable)) {
      problems.push(
        `${label}: a condição usa "${step.condition.variable}", que nenhum passo anterior define`,
      )
    }
    for (const name of placeholdersOf(...textsOf(step))) {
      if (!known.has(name)) {
        problems.push(
          `${label}: usa {{${name}}}, que nenhum passo anterior define`,
        )
      }
    }
    if (step.kind === 'MESSAGE' && !step.text && !step.instruction) {
      problems.push(`${label}: informe o texto ou a instrução da mensagem`)
    }
    for (const defined of variablesDefinedBy(step)) {
      if ((PROCEDURE_PRESET_VARIABLES as readonly string[]).includes(defined)) {
        problems.push(`${label}: "${defined}" é um nome reservado`)
      }
      known.add(defined)
    }
  })
  return problems
}
