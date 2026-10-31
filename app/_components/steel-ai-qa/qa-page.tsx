'use client'

import { CheckmarkBadge01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelAiNotice } from '@/app/_components/steel-ai/steel-ai-notice'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useQaConfig } from '@/src/hooks/use-qa-review'
import { QaCoachingPanel } from './qa-coaching-panel'
import { QaReviewsList } from './qa-reviews-list'
import { QaSettings } from './qa-settings'

type Tab = 'coaching' | 'reviews' | 'settings'

/**
 * `/ai/qualidade` — the automatic QA by AI: coaching per agent, every review
 * and (managers) the settings. `?review=<id>` opens a review straight away
 * (the low-score notification links there).
 */
export function QaPage({
  workspaceId,
  canManage,
  initialReviewId = null,
}: {
  workspaceId: string
  canManage: boolean
  initialReviewId?: string | null
}) {
  const [tab, setTab] = useState<Tab>(initialReviewId ? 'reviews' : 'coaching')
  const config = useQaConfig(workspaceId)
  const off = config.data?.enabled === false

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar title='Qualidade' />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-4xl space-y-5 px-4 pt-2 pb-10 sm:px-6 sm:pt-4'>
          <header className='space-y-1'>
            <h1 className='font-semibold text-lg'>Qualidade do atendimento</h1>
            <p className='max-w-prose text-muted-foreground text-sm'>
              A IA dá uma nota a cada conversa do zap e a cada chamado, humano
              ou bot, pelos critérios que você define — tom, resolução,
              conformidade, empatia — e aponta o que cada atendente pode
              melhorar. O custo entra na cota de IA do espaço de trabalho.
            </p>
          </header>

          {off ? (
            <SteelAiNotice tone='info' icon={CheckmarkBadge01Icon}>
              {canManage
                ? 'O QA automático está desligado. Ligue-o na aba Configuração para começar a avaliar.'
                : 'O QA automático está desligado neste espaço de trabalho.'}
            </SteelAiNotice>
          ) : null}

          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <TabsList aria-label='Seção da qualidade'>
              <TabsTrigger value='coaching'>Coaching</TabsTrigger>
              <TabsTrigger value='reviews'>Avaliações</TabsTrigger>
              <TabsTrigger value='settings'>Configuração</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'coaching' ? (
            <QaCoachingPanel workspaceId={workspaceId} />
          ) : tab === 'reviews' ? (
            <QaReviewsList
              workspaceId={workspaceId}
              initialReviewId={initialReviewId}
            />
          ) : (
            <QaSettings workspaceId={workspaceId} canEdit={canManage} />
          )}
        </div>
      </div>
    </div>
  )
}
