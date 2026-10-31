import { SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { AiActionsSection } from '@/app/_components/settings/ai-actions-section'
import { AiGuardrailsSection } from '@/app/_components/settings/ai-guardrails-section'
import { AiSettingsSection } from '@/app/_components/settings/ai-settings-section'
import { SteelIcon } from '@/components/icon/icon'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Steel IA | Steel',
  description:
    'Provedores e modelos de IA habilitados, modelo pessoal e cota de consumo do workspace',
}

export default async function SettingsSteelIntelligencePage({
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
  if (!membership.ok || !membership.value) notFound()

  return (
    <div className='w-full overflow-y-auto'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Steel IA'>
            <SteelIcon
              icon={SparklesIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='w-full space-y-6 p-6'>
        <div>
          <H3>Steel IA</H3>
          <Muted>
            Escolha quais provedores (OpenAI e Anthropic/Claude) e modelos o
            workspace pode usar, o modelo de cada tipo de tarefa, a contingência
            entre provedores e a cota mensal de consumo.
          </Muted>
        </div>
        <AiSettingsSection workspaceId={membership.value.workspaceId} />
        <div className='max-w-4xl space-y-6 pt-4'>
          <div>
            <H3>Proteções e LGPD</H3>
            <Muted>
              Mascaramento de dados pessoais, defesa contra textos que tentam
              dar ordens à IA e limites do que a resposta automática pode
              prometer.
            </Muted>
          </div>
          <AiGuardrailsSection workspaceId={membership.value.workspaceId} />
        </div>
        <div className='max-w-4xl space-y-6 pt-4'>
          <div>
            <H3>Ações da IA</H3>
            <Muted>
              Conectores com os sistemas do cliente (pedidos, senhas, acessos) e
              as ferramentas que a resposta automática do WhatsApp pode usar,
              cada uma automática ou com aprovação.
            </Muted>
          </div>
          <AiActionsSection workspaceId={membership.value.workspaceId} />
        </div>
      </div>
    </div>
  )
}
