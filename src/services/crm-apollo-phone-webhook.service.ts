import z from 'zod'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { crmApolloImportNotFound } from '@/src/errors'
import {
  APOLLO_LEAD_SOURCE,
  APOLLO_SOURCE,
  type ApolloPhoneOnlyPerson,
  sanitizeApolloPhones,
} from '@/src/lib/integrations/apollo'
import {
  APOLLO_WEBHOOK_TTL_MS,
  hashApolloWebhookToken,
} from '@/src/lib/integrations/apollo-webhook'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmApolloImportRepository } from '@/src/repositories/crm-apollo-import.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import type { ApolloPhoneWebhookDTO } from '@/src/schemas/crm-apollo.schema'
import { CrmLeadService } from './crm-lead.service'

/**
 * Applies the phones Apollo delivers (minutes after the import) to the leads
 * the import created. Idempotent: numbers already on the lead are skipped, so
 * Apollo's retries change nothing and are not counted twice.
 */

const PhoneOnlyPersonSchema = z.object({ id: z.string().min(1) })

function phoneOnlyIndex(raw: unknown): Map<string, ApolloPhoneOnlyPerson> {
  const index = new Map<string, ApolloPhoneOnlyPerson>()
  if (!Array.isArray(raw)) return index
  for (const entry of raw) {
    const parsed = PhoneOnlyPersonSchema.safeParse(entry)
    if (parsed.success)
      index.set(parsed.data.id, entry as ApolloPhoneOnlyPerson)
  }
  return index
}

function clip(value: string | null | undefined, max: number) {
  const text = value?.trim()
  return text ? text.slice(0, max) : undefined
}

export const CrmApolloPhoneWebhookService = {
  async handle(
    token: string,
    payload: ApolloPhoneWebhookDTO,
  ): Promise<Result<{ received: number; created: number }>> {
    const found = await CrmApolloImportRepository.findByWebhookTokenHash(
      hashApolloWebhookToken(token),
    )
    if (!found.ok) return found
    const row = found.value
    if (
      row.finishedAt &&
      Date.now() - row.finishedAt.getTime() > APOLLO_WEBHOOK_TTL_MS
    ) {
      return err(crmApolloImportNotFound())
    }

    const result = payload.webhook_result
    if (!result || result.people.length === 0) {
      return ok({ received: 0, created: 0 })
    }

    const pending = phoneOnlyIndex(row.phoneOnlyPeople)
    let received = 0
    let created = 0

    for (const person of result.people) {
      const phones = sanitizeApolloPhones(person.phone_numbers)
      if (phones.length === 0) continue

      const appended = await CrmLeadRepository.appendPhonesByExternalId(
        row.workspaceId,
        APOLLO_SOURCE,
        person.id,
        phones,
      )
      if (!appended.ok) {
        logger.warn(
          'crm.apollo.phone_append_failed',
          logFields(
            {
              component: 'CrmApolloPhoneWebhook',
              workspaceId: row.workspaceId,
            },
            { importId: row.id, code: appended.error.code },
          ),
        )
        continue
      }
      if (appended.value.found) {
        if (appended.value.added > 0) received += 1
        continue
      }

      const candidate = pending.get(person.id)
      if (!candidate) continue
      const intake = await CrmLeadService.intake(
        row.workspaceId,
        {
          kind: 'system',
          createdById: row.createdById,
          via: 'apollo',
          refId: row.id,
        },
        {
          name: clip(candidate.name, 200) ?? phones[0],
          phones,
          company: clip(candidate.company, 200),
          jobTitle: clip(candidate.title, 150),
          city: clip(candidate.city, 100),
          linkedin: clip(candidate.linkedin, 300),
          source: APOLLO_LEAD_SOURCE,
        },
        { quiet: true, external: { source: APOLLO_SOURCE, id: person.id } },
      )
      if (intake.ok && intake.value.created) {
        received += 1
        created += 1
      } else if (!intake.ok) {
        logger.warn(
          'crm.apollo.phone_intake_failed',
          logFields(
            {
              component: 'CrmApolloPhoneWebhook',
              workspaceId: row.workspaceId,
            },
            { importId: row.id, code: intake.error.code },
          ),
        )
      }
    }

    if (received > 0) {
      // Credits ride on the delivery that changed something, so a retry of
      // the same payload (nothing new to apply) is never charged twice.
      await CrmApolloImportRepository.addPhoneProgress(row.id, {
        received,
        created,
        credits: Math.round(result.credits_consumed ?? 0),
      })
      auditMutation({
        entity: 'crm_apollo_import',
        action: 'update',
        actorId: null,
        targetId: row.id,
        meta: {
          workspaceId: row.workspaceId,
          phonesApplied: received,
          leadsCreated: created,
        },
      })
    }
    return ok({ received, created })
  },
}
