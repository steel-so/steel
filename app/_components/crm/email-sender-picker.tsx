'use client'

import { Alert02Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCrmEmailSenders } from '@/src/hooks/use-crm-email-senders'
import { emailDomainsHref } from './newsletters/newsletter-sender-badge'

function splitAddress(value: string): { local: string; domain: string } {
  const at = value.lastIndexOf('@')
  if (at === -1) return { local: value, domain: '' }
  return {
    local: value.slice(0, at),
    domain: value
      .slice(at + 1)
      .trim()
      .toLowerCase(),
  }
}

/**
 * Sender of a CRM campaign (ADR 0055): a local part on one of the
 * workspace's VERIFIED sending domains or on Steel's own mail domain. A saved
 * From outside both (scheduled before the rule) is shown with a warning
 * until the user picks a valid one.
 */
export function EmailSenderPicker({
  workspaceId,
  workspaceSlug,
  value,
  onChange,
  id = 'email-from',
  label = 'Remetente',
}: {
  workspaceId: string
  workspaceSlug: string
  value: string
  onChange: (email: string) => void
  id?: string
  label?: string
}) {
  const senders = useCrmEmailSenders(workspaceId)
  const [pendingDomain, setPendingDomain] = useState<string | null>(null)

  if (senders.isLoading) {
    return (
      <div className='flex flex-col gap-2'>
        <Label htmlFor={id}>{label}</Label>
        <Skeleton className='h-9 w-full' />
      </div>
    )
  }

  // Without the options the user can still type; the checklist validates.
  if (!senders.data) {
    return (
      <div className='flex flex-col gap-2'>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type='email'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='marketing@suaempresa.com.br'
        />
        <p className='text-muted-foreground text-xs'>
          Não foi possível carregar os domínios verificados.
        </p>
      </div>
    )
  }

  const { platformDomain, verifiedDomains } = senders.data
  // The workspace's verified domains first, then Steel's own domain.
  const domains = [
    ...verifiedDomains.filter((name) => name !== platformDomain),
    platformDomain,
  ]
  const current = value.trim()
  const { local, domain } = splitAddress(current)
  const knownDomain = domains.includes(domain)
  const unverified = Boolean(current) && !knownDomain

  const selection = knownDomain
    ? domain
    : pendingDomain && domains.includes(pendingDomain)
      ? pendingDomain
      : (domains[0] as string)

  const items = domains.map((name) => ({
    value: name,
    label: name === platformDomain ? `${name} (Steel)` : name,
  }))

  function chooseDomain(next: string) {
    setPendingDomain(next)
    const part = local.trim()
    onChange(part ? `${part}@${next}` : '')
  }

  function changeLocal(next: string) {
    const part = next.replace(/@.*$/, '').trim()
    onChange(part ? `${part}@${selection}` : '')
  }

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <Label htmlFor={id}>{label}</Label>
      <div className='flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <Input
            id={id}
            value={local}
            onChange={(e) => changeLocal(e.target.value)}
            placeholder='marketing'
            autoComplete='off'
            aria-describedby={`${id}-help`}
            className='min-w-0'
          />
          <span aria-hidden='true' className='text-muted-foreground'>
            @
          </span>
        </div>
        <Select
          items={items}
          value={selection}
          onValueChange={(next) => chooseDomain(next as string)}
        >
          <SelectTrigger
            id={`${id}-domain`}
            aria-label='Domínio do remetente'
            className='w-full min-w-0 sm:w-auto sm:max-w-[60%]'
          >
            <SelectValue placeholder='Escolha o domínio' />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {unverified ? (
        <p
          role='alert'
          className='flex items-start gap-1.5 text-destructive text-xs'
        >
          <SteelIcon icon={Alert02Icon} size={14} className='mt-px shrink-0' />
          <span>
            O remetente atual, {current}, não é de um domínio verificado e não
            será enviado. Escolha um domínio verificado ou o domínio do Steel.
          </span>
        </p>
      ) : null}
      <p id={`${id}-help`} className='text-muted-foreground text-xs'>
        {verifiedDomains.length === 0
          ? `Nenhum domínio verificado ainda: use um endereço @${platformDomain} ou cadastre o da sua empresa em `
          : 'Só domínios verificados aparecem aqui, além do domínio do Steel. '}
        <Link
          href={emailDomainsHref(workspaceSlug)}
          className='underline underline-offset-2'
        >
          Ajustes › Domínios de e-mail
        </Link>
      </p>
    </div>
  )
}
