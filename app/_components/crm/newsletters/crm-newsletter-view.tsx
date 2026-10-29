'use client'

import { ArrowLeft01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { NewsletterWelcomeTab } from '@/app/_components/crm/newsletters/automation/newsletter-welcome-tab'
import { NewsletterDigestTab } from '@/app/_components/crm/newsletters/digest/newsletter-digest-tab'
import { NewsletterIssuesTab } from '@/app/_components/crm/newsletters/issues/newsletter-issues-tab'
import { NewsletterSegmentsButton } from '@/app/_components/crm/newsletters/segments/newsletter-segments-dialog'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCrmNewsletter } from '@/src/hooks/use-crm-newsletters'
import { NewsletterSenderBadge } from './newsletter-sender-badge'
import { NewsletterSettingsTab } from './newsletter-settings-tab'
import { NewsletterSubscribersTab } from './newsletter-subscribers-tab'

const TABS = [
  'edicoes',
  'assinantes',
  'configuracoes',
  'boas-vindas',
  'resumo',
] as const
type Tab = (typeof TABS)[number]

function initialTab(): Tab {
  if (typeof window === 'undefined') return 'edicoes'
  const value = new URLSearchParams(window.location.search).get('aba')
  return (TABS as readonly string[]).includes(value ?? '')
    ? (value as Tab)
    : 'edicoes'
}

/** Newsletter page: tabs Edições, Assinantes and Configurações. */
export function CrmNewsletterView({
  workspaceId,
  slug,
  newsletterId,
}: {
  workspaceId: string
  slug: string
  newsletterId: string
}) {
  const newsletter = useCrmNewsletter(workspaceId, newsletterId)
  const [tab, setTab] = useState<Tab>(initialTab)

  function changeTab(value: unknown) {
    if (!(TABS as readonly unknown[]).includes(value)) return
    setTab(value as Tab)
    const url = new URL(window.location.href)
    url.searchParams.set('aba', value as Tab)
    window.history.replaceState(null, '', url)
  }

  if (newsletter.isLoading) {
    return (
      <div className='flex flex-col gap-4 p-4 sm:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }
  if (!newsletter.data) {
    return (
      <div className='flex flex-col items-center gap-3 p-10 text-center'>
        <p className='font-medium'>Newsletter não encontrada</p>
        <Button
          variant='outline'
          render={<Link href={`/${slug}/crm/newsletters`} />}
        >
          Voltar para as newsletters
        </Button>
      </div>
    )
  }

  const data = newsletter.data
  return (
    <div className='flex min-w-0 flex-col gap-4 p-4 sm:p-6'>
      <div className='flex min-w-0 flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 items-start gap-2'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Voltar'
            render={<Link href={`/${slug}/crm/newsletters`} />}
          >
            <SteelIcon icon={ArrowLeft01Icon} />
          </Button>
          <div className='min-w-0'>
            <h1 className='truncate font-semibold text-lg'>{data.name}</h1>
            <p className='truncate text-muted-foreground text-sm'>
              {data.fromName} · {data.fromEmail}
            </p>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {data.status === 'ARCHIVED' ? (
            <Badge variant='outline'>Arquivada</Badge>
          ) : null}
          <NewsletterSenderBadge
            verified={data.senderVerified}
            workspaceSlug={slug}
          />
          <NewsletterSegmentsButton
            workspaceId={workspaceId}
            newsletterId={newsletterId}
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value='edicoes'>Edições</TabsTrigger>
          <TabsTrigger value='assinantes'>
            Assinantes
            <span className='text-muted-foreground tabular-nums'>
              {data.counts.active.toLocaleString('pt-BR')}
            </span>
          </TabsTrigger>
          <TabsTrigger value='boas-vindas'>Boas-vindas</TabsTrigger>
          <TabsTrigger value='configuracoes'>Configurações</TabsTrigger>
          <TabsTrigger value='resumo'>Resumo</TabsTrigger>
        </TabsList>
        <TabsContent value='edicoes' className='pt-4'>
          <NewsletterIssuesTab
            workspaceId={workspaceId}
            workspaceSlug={slug}
            newsletterId={newsletterId}
            senderVerified={data.senderVerified}
          />
        </TabsContent>
        <TabsContent value='assinantes' className='pt-4'>
          <NewsletterSubscribersTab
            workspaceId={workspaceId}
            newsletter={data}
          />
        </TabsContent>
        <TabsContent value='boas-vindas' className='pt-4'>
          <NewsletterWelcomeTab
            workspaceId={workspaceId}
            workspaceSlug={slug}
            newsletterId={newsletterId}
            senderVerified={data.senderVerified}
          />
        </TabsContent>
        <TabsContent value='configuracoes' className='pt-4'>
          <NewsletterSettingsTab
            workspaceId={workspaceId}
            slug={slug}
            newsletter={data}
          />
        </TabsContent>
        <TabsContent value='resumo' className='pt-4'>
          <NewsletterDigestTab
            workspaceId={workspaceId}
            workspaceSlug={slug}
            newsletterId={newsletterId}
            archived={data.status === 'ARCHIVED'}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
