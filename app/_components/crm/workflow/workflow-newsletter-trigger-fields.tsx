'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrmNewsletters } from '@/src/hooks/use-crm-newsletters'
import type { CrmWorkflowTriggerData } from '@/src/schemas/crm-workflow.schema'

type NewsletterTrigger = Extract<
  CrmWorkflowTriggerData,
  { type: `newsletter-${string}` }
>

export function isNewsletterTriggerData(
  data: CrmWorkflowTriggerData,
): data is NewsletterTrigger {
  return data.type.startsWith('newsletter-')
}

const ANY = ''

/** Opens and clicks come from issues and from the welcome series. */
const SOURCE_LABEL = {
  [ANY]: 'Edições e e-mails de boas-vindas',
  issue: 'Só edições',
  welcome: 'Só e-mails de boas-vindas',
} as const

/**
 * Filters of the newsletter triggers (ADR 0054 phase 2): which newsletter
 * (any by default), for opens and clicks the origin (issue or welcome
 * series, slice nl3-welcome-bridge) and, for link clicks, "URL contains".
 */
export function WorkflowNewsletterTriggerFields({
  workspaceId,
  data,
  onChange,
}: {
  workspaceId?: string
  data: NewsletterTrigger
  onChange: (next: NewsletterTrigger) => void
}) {
  const { data: newsletters } = useCrmNewsletters(workspaceId ?? '')
  const options = (newsletters ?? []).filter((n) => n.status === 'ACTIVE')
  const selected = data.newsletterId ?? ANY
  const missing =
    selected !== ANY && newsletters && !options.some((n) => n.id === selected)
  const opensOrClicks =
    data.type === 'newsletter-issue-opened' ||
    data.type === 'newsletter-link-clicked'
      ? data
      : null

  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <Label
          htmlFor='wf-newsletter-filter'
          className='text-muted-foreground text-xs'
        >
          Newsletter
        </Label>
        <select
          id='wf-newsletter-filter'
          className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
          value={selected}
          onChange={(e) =>
            onChange({ ...data, newsletterId: e.target.value || undefined })
          }
        >
          <option value={ANY}>Qualquer newsletter</option>
          {missing ? (
            <option value={selected}>Newsletter indisponível</option>
          ) : null}
          {options.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </div>
      {opensOrClicks ? (
        <div className='space-y-1.5'>
          <Label
            htmlFor='wf-newsletter-source'
            className='text-muted-foreground text-xs'
          >
            Origem do e-mail
          </Label>
          <select
            id='wf-newsletter-source'
            className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
            value={opensOrClicks.source ?? ANY}
            onChange={(e) => {
              const value = e.target.value
              onChange({
                ...opensOrClicks,
                source:
                  value === 'issue' || value === 'welcome' ? value : undefined,
              })
            }}
          >
            {Object.entries(SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {data.type === 'newsletter-link-clicked' ? (
        <div className='space-y-1.5'>
          <Label
            htmlFor='wf-newsletter-url'
            className='text-muted-foreground text-xs'
          >
            URL contém (opcional)
          </Label>
          <Input
            id='wf-newsletter-url'
            value={data.urlContains ?? ''}
            placeholder='Ex.: /precos'
            maxLength={500}
            onChange={(e) =>
              onChange({ ...data, urlContains: e.target.value || undefined })
            }
          />
          <p className='text-muted-foreground/70 text-xs'>
            Dispara uma vez por pessoa e link em cada edição ou e-mail de
            boas-vindas.
          </p>
        </div>
      ) : null}
      <p className='text-muted-foreground text-xs'>
        O assinante fica em {'{{trigger.record.email}}'} e a newsletter em{' '}
        {'{{trigger.payload.newsletter.name}}'}.
        {opensOrClicks
          ? ` A origem fica em {{trigger.payload.source}} ("issue" ou "welcome").`
          : ''}
      </p>
    </div>
  )
}
