import type { WhatsAppTemplate } from '@prisma/client'
import { validationError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  templateButtons,
  templateHasVariables,
} from '@/src/lib/whatsapp/template-send'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'

/**
 * Save-time rules of the SEND_TEMPLATE button action: the target exists, is
 * APPROVED, has no variables and belongs to the connection of the template
 * that carries the button. A template can never reach itself through a chain
 * of SEND_TEMPLATE actions (A -> B -> A), so the graph stays acyclic and the
 * chain is finite. At runtime every hop needs a new click from the contact,
 * so there is no unattended loop either way.
 */

interface ButtonLike {
  type: string
  actions?: { kind: string; templateId?: string }[]
}

/** Upper bound of the cycle search (chains this long are refused anyway). */
const MAX_CHAIN_DEPTH = 20

export function sendTemplateTargets(buttons: readonly ButtonLike[]): string[] {
  const ids = new Set<string>()
  for (const button of buttons) {
    if (button.type !== 'REPLY') continue
    for (const action of button.actions ?? []) {
      if (action.kind === 'SEND_TEMPLATE' && action.templateId) {
        ids.add(action.templateId)
      }
    }
  }
  return [...ids]
}

/** Why the template cannot be sent by a button, or null when it can. */
export function sendTemplateTargetProblem(
  template: Pick<
    WhatsAppTemplate,
    'status' | 'connectionId' | 'components'
  > | null,
  connectionId: string | null,
): string | null {
  if (!template) return 'O template escolhido para o botão não existe'
  if (template.status !== 'APPROVED') {
    return 'O template escolhido para o botão precisa estar aprovado'
  }
  if (connectionId && template.connectionId !== connectionId) {
    return 'O template escolhido para o botão precisa ser da mesma conexão'
  }
  if (templateHasVariables(template)) {
    return 'O template escolhido para o botão tem variáveis ({{1}}), que o clique não consegue preencher'
  }
  return null
}

export const WhatsAppButtonSendTemplateGuard = {
  /**
   * Validates the SEND_TEMPLATE actions of `buttons`. `ownerTemplateId` is
   * the template carrying them (null for a quick reply or a template not
   * saved yet); `connectionId` the connection they must stay in (null when
   * unknown, e.g. a quick reply — checked again when the click runs).
   */
  async assert(input: {
    workspaceId: string
    connectionId: string | null
    ownerTemplateId: string | null
    buttons: readonly ButtonLike[]
  }): Promise<Result<void>> {
    const targets = sendTemplateTargets(input.buttons)
    if (targets.length === 0) return ok(undefined)

    for (const targetId of targets) {
      if (targetId === input.ownerTemplateId) {
        return err(
          validationError(
            'Um template não pode enviar a si mesmo ao clicar no botão',
          ),
        )
      }
      const found = await WhatsAppTemplateRepository.findById(
        targetId,
        input.workspaceId,
      )
      if (!found.ok) return found
      const problem = sendTemplateTargetProblem(found.value, input.connectionId)
      if (problem) return err(validationError(problem))
    }

    if (input.ownerTemplateId) {
      const loop = await reaches(
        input.workspaceId,
        targets,
        input.ownerTemplateId,
      )
      if (!loop.ok) return loop
      if (loop.value) {
        return err(
          validationError(
            'Os botões formariam um laço: o template escolhido já leva de volta a este template',
          ),
        )
      }
    }
    return ok(undefined)
  },
}

/** Whether `goal` is reachable from `starts` through SEND_TEMPLATE actions. */
async function reaches(
  workspaceId: string,
  starts: string[],
  goal: string,
): Promise<Result<boolean>> {
  const seen = new Set<string>()
  let frontier = starts
  for (let depth = 0; depth < MAX_CHAIN_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      if (id === goal) return ok(true)
      if (seen.has(id)) continue
      seen.add(id)
      const found = await WhatsAppTemplateRepository.findById(id, workspaceId)
      if (!found.ok) return found
      if (found.value) {
        next.push(...sendTemplateTargets(templateButtons(found.value)))
      }
    }
    frontier = next
  }
  // A chain longer than the bound is treated as a loop.
  return ok(frontier.length > 0)
}
