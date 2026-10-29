import {
  AiMagicIcon,
  ChartHistogramIcon,
  Chatting01Icon,
  DashboardSquare01Icon,
  FlashIcon,
  Megaphone01Icon,
  Settings02Icon,
  Shapes01Icon,
  StarIcon,
  UserGroup03Icon,
  UserGroupIcon,
  UserMultipleIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { notFound } from 'next/navigation'
import { type ReactNode, Suspense } from 'react'
import {
  ContextHeader,
  ContextSidebar,
  NavGroup,
  NavItem,
} from '@/app/_components/navigation/sidebar-context'
import { WhatsappPresenceSlot } from '@/app/_components/whatsapp/whatsapp-presence-slot'
import { hasModuleAccess } from '@/src/lib/module-access-guard'

export default async function ZapLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  if (!(await hasModuleAccess(slug, 'COMMUNICATION'))) notFound()
  const base = `/${slug}/zap`

  return (
    <>
      <ContextSidebar>
        <ContextHeader title='WhatsApp' />
        <Suspense fallback={null}>
          <WhatsappPresenceSlot slug={slug} />
        </Suspense>
        <NavGroup>
          <NavItem href={base} icon={Chatting01Icon}>
            Conversas
          </NavItem>
          <NavItem href={`${base}/grupos`} icon={UserGroupIcon}>
            Grupos
          </NavItem>
          <NavItem href={`${base}/equipes`} icon={UserGroup03Icon}>
            Equipes
          </NavItem>
        </NavGroup>
        <NavGroup>
          <NavItem href={`${base}/contatos`} icon={UserMultipleIcon}>
            Contatos
          </NavItem>
          <NavItem href={`${base}/templates`} icon={Shapes01Icon}>
            Templates
          </NavItem>
          <NavItem href={`${base}/mensagens-rapidas`} icon={FlashIcon}>
            Mensagens rápidas
          </NavItem>
          <NavItem href={`${base}/transmissoes`} icon={Megaphone01Icon}>
            Transmissões
          </NavItem>
          <NavItem href={`${base}/campanhas-ia`} icon={AiMagicIcon}>
            Campanhas de IA
          </NavItem>
        </NavGroup>
        <NavGroup>
          <NavItem href={`${base}/dashboards`} icon={DashboardSquare01Icon}>
            Painéis
          </NavItem>
          <NavItem href={`${base}/reports`} icon={ChartHistogramIcon}>
            Relatórios
          </NavItem>
          <NavItem href={`${base}/pesquisas`} icon={StarIcon}>
            Pesquisas
          </NavItem>
        </NavGroup>
        <NavGroup>
          <NavItem href={`${base}/configuracoes`} icon={Settings02Icon}>
            Configurações
          </NavItem>
        </NavGroup>
      </ContextSidebar>
      {children}
    </>
  )
}
