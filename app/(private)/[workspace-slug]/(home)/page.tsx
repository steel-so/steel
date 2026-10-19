import { Home09Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { HomeSteelAiPrompt } from '@/app/_components/home/home-steel-ai-prompt'
import { AiInsightHighlights } from '@/app/_components/steel-ai-insights/ai-insight-highlights'
import { UserShortcutLinkList } from '@/app/_components/user/shortcut-link/user-shortcut-link-list'
import { UserShortcutLinkModal } from '@/app/_components/user/shortcut-link/user-shortcut-link-modal'
import { UserStickyCreateButton } from '@/app/_components/user/sticky/user-sticky-create-button'
import { UserStickyList } from '@/app/_components/user/sticky/user-sticky-list'
import { SteelIcon } from '@/components/icon/icon'
import { H4 } from '@/components/typography/heading/h4'
import { Muted } from '@/components/typography/text/muted'
import { Small } from '@/components/typography/text/small'
import { getAuthSession } from '@/src/lib/auth-session'
import { PREFERENCE_COOKIES } from '@/src/lib/preference-cookies'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Página inicial | Steel',
  description: 'Seu painel inicial com o Steel AI, links rápidos e anotações.',
}

// A maioria dos usuários nunca configurou um fuso em Preferências (a
// coluna nasce com "UTC" por padrão) — cair pra "UTC" faz o servidor
// (que roda em UTC) achar que é noite às 15h de Brasília. São Paulo é
// uma aposta muito melhor que UTC pro público do produto.
const DEFAULT_TIMEZONE = 'America/Sao_Paulo'

/** Fuso pra formatação SSR: cookie espelhado da preferência, com fallback seguro. */
async function resolveTimezone() {
  const cookieStore = await cookies()
  const tz = cookieStore.get(PREFERENCE_COOKIES.timezone)?.value

  if (!tz) return DEFAULT_TIMEZONE

  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_TIMEZONE
  }
}

async function getGreeting(timezone: string) {
  'use cache'
  cacheLife('hours')
  cacheTag('greeting')

  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  )

  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'

  return 'Boa noite'
}

/** First name only: the greeting is a salutation, not an identity check. */
function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? ''
}

async function getFullDate(timezone: string) {
  'use cache'
  cacheLife('hours')
  cacheTag('full-date')

  // Sem hour/minute de propósito: isso é cacheado por até 1h (cacheLife
  // 'hours'), então uma hora exata aqui ficaria visivelmente desatualizada
  // dentro dessa janela — só o dia/mês/semana, que não muda por horas.
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone: timezone,
  })
    .formatToParts(new Date())
    .map((part) =>
      part.type === 'weekday' || part.type === 'month'
        ? part.value.charAt(0).toUpperCase() + part.value.slice(1)
        : part.value,
    )
    .join('')
}

export default async function Page({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) redirect('/create-workspace')

  const timezone = await resolveTimezone()
  const [greeting, fullDate] = await Promise.all([
    getGreeting(timezone),
    getFullDate(timezone),
  ])
  const greeted = firstName(session.value.user.name)

  return (
    <div className='w-full h-full overflow-y-scroll'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title={'Página inicial'}>
            <SteelIcon
              icon={Home09Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='max-w-200 w-full h-full mx-auto p-6 space-y-8'>
        <div className='text-center'>
          <H4>
            {greeting}
            {greeted && `, ${greeted}`}
          </H4>
          <Muted>{fullDate}</Muted>
        </div>

        <HomeSteelAiPrompt
          workspaceId={membership.value.workspaceId}
          slug={slug}
        />

        <AiInsightHighlights
          workspaceId={membership.value.workspaceId}
          slug={slug}
        />

        <div className='flex flex-col flex-wrap w-full gap-y-3'>
          <div className='w-full flex items-center justify-between'>
            <Small>Links rápidos</Small>
            <UserShortcutLinkModal />
          </div>
          <UserShortcutLinkList />
        </div>

        <div className='flex flex-col flex-wrap w-full gap-y-3'>
          <div className='w-full flex items-center justify-between'>
            <Small>Suas anotações</Small>
            <UserStickyCreateButton />
          </div>
          <div>
            <UserStickyList />
          </div>
        </div>
      </div>
    </div>
  )
}
