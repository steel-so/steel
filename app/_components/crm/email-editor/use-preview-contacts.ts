'use client'

import { useMemo } from 'react'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import { SAMPLE_CONTACT } from '@/src/lib/crm-email-builder/variables'
import type { EmailBuilderContact } from '@/src/schemas/crm-email-builder.schema'
import type { CrmPersonDTO } from '@/types/crm-person'

const LOOKUPS: LookupKind[] = ['companies']
/** People offered in the "Ver como" list. */
export const CONTACT_OPTION_LIMIT = 50

export const SAMPLE_KEY = 'sample'
export const TOKENS_KEY = 'tokens'

export type PreviewContactOption = { value: string; label: string }

/**
 * Contacts the preview and the test send can borrow variables from: the
 * sample contact, the raw `{{variables}}` (preview only) and real CRM
 * people (`person:<id>`).
 */
export function usePreviewContacts(workspaceId: string) {
  const { items: people, isLoading } = useCrmResourceList<CrmPersonDTO>(
    workspaceId,
    'people',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUPS)

  const options = useMemo<PreviewContactOption[]>(
    () =>
      people.slice(0, CONTACT_OPTION_LIMIT).map((person) => ({
        value: `person:${person.id}`,
        label: person.emails[0]
          ? `${person.name} · ${person.emails[0]}`
          : person.name,
      })),
    [people],
  )

  /** The contact behind a key; `null` shows the variables as they are. */
  const resolve = (key: string): EmailBuilderContact | null => {
    if (key === TOKENS_KEY) return null
    const person = people.find((p) => `person:${p.id}` === key)
    if (!person) return SAMPLE_CONTACT
    return {
      email: person.emails[0] ?? '',
      name: person.name,
      company: person.companyId
        ? lookups.maps.companies[person.companyId]
        : undefined,
      jobTitle: person.jobTitle ?? undefined,
      phone: person.phones[0],
      city: person.city ?? undefined,
    }
  }

  return { options, resolve, isLoading }
}

/** `person:<id>` → the id, for the test-send API. */
export function personIdOf(key: string): string | undefined {
  return key.startsWith('person:') ? key.slice('person:'.length) : undefined
}
