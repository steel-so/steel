import { notFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmEmailConditionRepository } from '@/src/repositories/crm-email-condition.repository'
import type { CrmEmailContactListsDTO } from '@/types/crm-email-editor'
import { assertModuleMember } from './authz'

/**
 * Conditional content of the e-mail editor (E3, "Mostrar se"): what the
 * preview needs to show a CRM person's version of the e-mail. The send
 * paths evaluate conditions themselves (crm-email-builder and
 * crm-email-campaign services).
 */
export const CrmEmailConditionService = {
  /** Mailing lists of a CRM person ("Ver como" in the preview). */
  async contactLists(
    actorId: string,
    workspaceId: string,
    personId: string,
  ): Promise<Result<CrmEmailContactListsDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const lists = await CrmEmailConditionRepository.findPersonListIds(
      workspaceId,
      personId,
    )
    if (!lists.ok) return lists
    if (!lists.value) return err(notFound('CrmPerson'))
    return ok({ listIds: lists.value })
  },
}
