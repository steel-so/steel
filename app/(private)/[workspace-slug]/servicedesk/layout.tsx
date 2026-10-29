import {
  AiMagicIcon,
  Alert02Icon,
  AlertDiamondIcon,
  ArrowDataTransferHorizontalIcon,
  BookOpen01Icon,
  Bug01Icon,
  Building03Icon,
  ContactBookIcon,
  CustomerService01Icon,
  DashboardSquare01Icon,
  FireIcon,
  HardDriveIcon,
  Home01Icon,
  Megaphone01Icon,
  ServerStack01Icon,
  Settings02Icon,
  Ticket01Icon,
  TicketStarIcon,
  UserAccountIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  ContextHeader,
  ContextSidebar,
  NavGroup,
  NavItem,
} from '@/app/_components/navigation/sidebar-context'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdModuleRail } from '@/app/_components/servicedesk/shell/sd-context-rail'
import { RouteShortcuts } from '@/app/_components/shortcuts/route-shortcuts'
import { hasModuleAccess } from '@/src/lib/module-access-guard'

export default async function ServiceDeskLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  if (!(await hasModuleAccess(slug, 'SERVICE_DESK'))) notFound()
  // Agente × solicitante (sem departamento): o menu do solicitante só tem
  // o portal e a base de conhecimento.
  const ctx = await loadSdDirectoryContext(slug)
  if (!ctx) notFound()
  const base = `/${slug}/servicedesk`

  if (!ctx.isAgent) {
    return (
      <>
        <SdModuleRail base={base}>
          <ContextSidebar>
            <ContextHeader title='ServiceDesk' />
            <NavGroup>
              <NavItem href={`${base}/portal`} icon={CustomerService01Icon}>
                Portal do solicitante
              </NavItem>
              <NavItem href={`${base}/knowledge`} icon={BookOpen01Icon}>
                Base de conhecimento
              </NavItem>
            </NavGroup>
          </ContextSidebar>
        </SdModuleRail>
        <RouteShortcuts
          routes={[{ id: 'sd.go-knowledge', href: `${base}/knowledge` }]}
        />
        {children}
      </>
    )
  }

  return (
    <>
      <SdModuleRail base={base}>
        <ContextSidebar>
          <ContextHeader title='ServiceDesk' />
          <NavGroup>
            <NavItem href={base} icon={Home01Icon}>
              Início
            </NavItem>
            <NavItem href={`${base}/portal`} icon={CustomerService01Icon}>
              Portal do solicitante
            </NavItem>
          </NavGroup>
          <NavGroup>
            <NavItem href={`${base}/tickets`} icon={Ticket01Icon}>
              Todos os chamados
            </NavItem>
            <NavItem href={`${base}/incidents`} icon={Alert02Icon}>
              Incidentes
            </NavItem>
            <NavItem href={`${base}/requests`} icon={TicketStarIcon}>
              Requisições
            </NavItem>
            <NavItem
              href={`${base}/changes`}
              icon={ArrowDataTransferHorizontalIcon}
            >
              Mudanças
            </NavItem>
            <NavItem href={`${base}/problems`} icon={Bug01Icon}>
              Problemas
            </NavItem>
            <NavItem href={`${base}/major-incidents`} icon={FireIcon}>
              Incidentes maiores
            </NavItem>
            <NavItem href={`${base}/status-pages`} icon={Megaphone01Icon}>
              Páginas de status
            </NavItem>
            <NavItem href={`${base}/risk`} icon={AlertDiamondIcon}>
              Análise de risco
            </NavItem>
            <NavItem href={`${base}/ai-comparison`} icon={AiMagicIcon}>
              IA vs. técnico
            </NavItem>
          </NavGroup>
          <NavGroup>
            <NavItem href={`${base}/customers`} icon={UserAccountIcon}>
              Clientes
            </NavItem>
            <NavItem href={`${base}/companies`} icon={Building03Icon}>
              Empresas
            </NavItem>
            <NavItem href={`${base}/contacts`} icon={ContactBookIcon}>
              Contatos
            </NavItem>
            <NavItem href={`${base}/config-items`} icon={ServerStack01Icon}>
              Itens de configuração
            </NavItem>
            <NavItem href={`${base}/inventory`} icon={HardDriveIcon}>
              Inventário
            </NavItem>
          </NavGroup>
          <NavGroup>
            <NavItem href={`${base}/knowledge`} icon={BookOpen01Icon}>
              Base de conhecimento
            </NavItem>
            <NavItem href={`${base}/dashboards`} icon={DashboardSquare01Icon}>
              Painéis
            </NavItem>
          </NavGroup>
          <NavGroup>
            <NavItem href={`${base}/settings`} icon={Settings02Icon}>
              Configurações
            </NavItem>
          </NavGroup>
        </ContextSidebar>
      </SdModuleRail>
      <RouteShortcuts
        routes={[
          { id: 'sd.go-tickets', href: `${base}/tickets` },
          { id: 'sd.go-incidents', href: `${base}/incidents` },
          { id: 'sd.go-requests', href: `${base}/requests` },
          { id: 'sd.go-changes', href: `${base}/changes` },
          { id: 'sd.go-problems', href: `${base}/problems` },
          { id: 'sd.go-knowledge', href: `${base}/knowledge` },
        ]}
      />
      {children}
    </>
  )
}
