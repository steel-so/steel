'use client'

import {
  Alert02Icon,
  CheckmarkBadge01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'

/** Where the workspace verifies its sending domains (nl-domains slice). */
export function emailDomainsHref(workspaceSlug: string): string {
  return `/${workspaceSlug}/settings/email-domains`
}

/** "Remetente verificado" or a link to verify the domain. */
export function NewsletterSenderBadge({
  verified,
  workspaceSlug,
}: {
  verified: boolean
  workspaceSlug: string
}) {
  if (verified) {
    return (
      <Badge variant='secondary'>
        <SteelIcon icon={CheckmarkBadge01Icon} /> Remetente verificado
      </Badge>
    )
  }
  return (
    <Badge
      variant='destructive'
      render={
        <Link
          href={emailDomainsHref(workspaceSlug)}
          title='Verifique o domínio em Ajustes › Domínios de e-mail'
        />
      }
    >
      <SteelIcon icon={Alert02Icon} /> Domínio não verificado
    </Badge>
  )
}
