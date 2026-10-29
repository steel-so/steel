'use client'

import {
  Activity01Icon,
  Cursor01Icon,
  Delete02Icon,
  Mail01Icon,
  MailOpen01Icon,
  MailRemove01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { PhoneCallList } from '@/app/_components/phone-calls/phone-call-list'
import { SteelIcon } from '@/components/icon/icon'
import { useCrmTimeline } from '@/src/hooks/use-crm-timeline'
import type { CrmActivityDTO } from '@/types/crm-activity'

type ActionMeta = { icon: typeof Activity01Icon; color: string; verb: string }

const ACTION_META: Record<CrmActivityDTO['action'], ActionMeta> = {
  CREATED: { icon: PlusSignIcon, color: 'text-emerald-600', verb: 'criou' },
  UPDATED: {
    icon: PencilEdit02Icon,
    color: 'text-blue-600',
    verb: 'atualizou',
  },
  DELETED: { icon: Delete02Icon, color: 'text-rose-600', verb: 'removeu' },
  // Newsletter bridge (ADR 0054 phase 2): the person did it, not a member,
  // so the summary is shown on its own.
  NEWSLETTER_SUBSCRIBED: {
    icon: Mail01Icon,
    color: 'text-primary',
    verb: 'assinou uma newsletter',
  },
  NEWSLETTER_CONFIRMED: {
    icon: Mail01Icon,
    color: 'text-primary',
    verb: 'confirmou a inscrição',
  },
  NEWSLETTER_UNSUBSCRIBED: {
    icon: MailRemove01Icon,
    color: 'text-muted-foreground',
    verb: 'saiu de uma newsletter',
  },
  NEWSLETTER_ISSUE_RECEIVED: {
    icon: Mail01Icon,
    color: 'text-muted-foreground',
    verb: 'recebeu uma edição',
  },
  NEWSLETTER_ISSUE_OPENED: {
    icon: MailOpen01Icon,
    color: 'text-primary',
    verb: 'abriu uma edição',
  },
  NEWSLETTER_LINK_CLICKED: {
    icon: Cursor01Icon,
    color: 'text-primary',
    verb: 'clicou em um link',
  },
  // Welcome series e-mails (slice nl3-welcome-bridge).
  NEWSLETTER_WELCOME_RECEIVED: {
    icon: Mail01Icon,
    color: 'text-muted-foreground',
    verb: 'recebeu um e-mail de boas-vindas',
  },
  NEWSLETTER_WELCOME_OPENED: {
    icon: MailOpen01Icon,
    color: 'text-primary',
    verb: 'abriu um e-mail de boas-vindas',
  },
  NEWSLETTER_WELCOME_LINK_CLICKED: {
    icon: Cursor01Icon,
    color: 'text-primary',
    verb: 'clicou em um link de boas-vindas',
  },
}

const FALLBACK_META: ActionMeta = {
  icon: Activity01Icon,
  color: 'text-muted-foreground',
  verb: 'registrou uma atividade',
}

/** Entries the contact did (newsletter), with no member as actor. */
const isContactAction = (action: string) => action.startsWith('NEWSLETTER_')

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes}min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.round(hours / 24)
  return `há ${days}d`
}

/** Feed cronológico de atividades de um registro (empresa, pessoa ou
 * oportunidade), renderizado no rodapé do `RecordPanel` via
 * `renderRecordExtra`. `userMap` resolve id→nome do ator. */
export function CrmRecordTimeline({
  workspaceId,
  companyId,
  personId,
  opportunityId,
  userMap = {},
}: {
  workspaceId: string
  companyId?: string
  personId?: string
  opportunityId?: string
  userMap?: Record<string, string>
}) {
  const { items, isLoading } = useCrmTimeline(workspaceId, {
    companyId,
    personId,
    opportunityId,
  })

  // Calls (ADR 0043) live on people and opportunities, not on companies.
  const callSource = opportunityId
    ? ({ kind: 'crm-opportunity', id: opportunityId } as const)
    : personId
      ? ({ kind: 'crm-person', id: personId } as const)
      : null

  return (
    <div className='flex flex-col gap-3'>
      {callSource ? (
        <PhoneCallList
          workspaceId={workspaceId}
          source={callSource}
          hideWhenEmpty
          taskTarget={(call) => ({
            kind: 'crm',
            personId: personId ?? call.crmPersonId,
            opportunityId: opportunityId ?? call.crmOpportunityId,
          })}
        />
      ) : null}
      <div className='flex items-center gap-2'>
        <SteelIcon
          icon={Activity01Icon}
          strokeWidth={2}
          className='size-4 text-muted-foreground'
        />
        <span className='font-medium text-sm'>Atividade</span>
      </div>

      {isLoading ? (
        <p className='text-muted-foreground text-sm'>Carregando…</p>
      ) : items.length === 0 ? (
        <p className='text-muted-foreground text-sm'>Sem atividade ainda.</p>
      ) : (
        <ol className='flex flex-col gap-3'>
          {items.map((item) => {
            const meta = ACTION_META[item.action] ?? FALLBACK_META
            const byContact = isContactAction(item.action)
            const actor = item.actorUserId
              ? (userMap[item.actorUserId] ?? 'Alguém')
              : 'Sistema'
            return (
              <li key={item.id} className='flex gap-2.5'>
                <div
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted ${meta.color}`}
                >
                  <SteelIcon
                    icon={meta.icon}
                    strokeWidth={2}
                    className='size-3.5'
                  />
                </div>
                <div className='min-w-0 flex-1'>
                  {byContact ? (
                    <p className='text-sm'>{item.summary ?? meta.verb}</p>
                  ) : (
                    <p className='text-sm'>
                      <span className='font-medium'>{actor}</span>{' '}
                      {item.summary ?? meta.verb}
                    </p>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    {formatRelative(item.createdAt)}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
