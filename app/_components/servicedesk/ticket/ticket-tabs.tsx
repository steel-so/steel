'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowUpDoubleIcon,
  BookOpen01Icon,
  Call02Icon,
  CheckListIcon,
  Clock01Icon,
  FireIcon,
  HierarchyIcon,
  HistoryIcon,
  Money03Icon,
  PackageIcon,
  Route01Icon,
  SignatureIcon,
  Task01Icon,
  UserGroupIcon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ComponentType } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { SdTicketTypeDTO } from '@/types/sd-ticket'
import { SdTicketApprovalsTab } from './tabs/approvals-tab'
import { SdTicketCallsTab } from './tabs/calls-tab'
import { SdTicketChangeTab } from './tabs/change-tab'
import { SdTicketChildrenTab } from './tabs/children-tab'
import { SdTicketCostsTab } from './tabs/costs-tab'
import { SdTicketEscalationTab } from './tabs/escalation-tab'
import { SdTicketHistoryTab } from './tabs/history-tab'
import { SdTicketHoursTab } from './tabs/hours-tab'
import { SdTicketKnowledgeTab } from './tabs/knowledge-tab'
import { SdTicketMajorIncidentTab } from './tabs/major-incident-tab'
import { SdTicketPartsTab } from './tabs/parts-tab'
import { SdTicketSignatureTab } from './tabs/signature-tab'
import { SdTicketSwarmTab } from './tabs/swarm-tab'
import { SdTicketTasksTab } from './tabs/tasks-tab'
import { SdTicketTraceabilityTab } from './tabs/traceability-tab'
import type { SdTicketTabProps } from './tabs/types'
import { SdTicketWhatsappTab } from './tabs/whatsapp-tab'

export interface SdTicketTabDef {
  id: string
  label: string
  icon: IconSvgElement
  component: ComponentType<SdTicketTabProps>
  /** Só na tela do agente (o portal usa `mode: 'requester'`). */
  agentOnly?: boolean
  /** Só nestes tipos de chamado (ausente = todos). */
  types?: readonly SdTicketTypeDTO[]
  /**
   * Fica sempre visível na barra; as demais vão para o menu "Mais" (a
   * ativa aparece na barra enquanto estiver aberta).
   */
  primary?: boolean
}

/**
 * Registro das abas da tela do chamado (ordem = ordem na tela). O id vai
 * na URL (`?tab=`). As abas vêm de fatias diferentes; todas seguem o
 * contrato `SdTicketTabProps`.
 */
export const SD_TICKET_TABS: SdTicketTabDef[] = [
  {
    id: 'history',
    label: 'Conversa',
    icon: HistoryIcon,
    component: SdTicketHistoryTab,
    primary: true,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: WhatsappIcon,
    component: SdTicketWhatsappTab,
    agentOnly: true,
  },
  {
    id: 'calls',
    label: 'Ligações',
    icon: Call02Icon,
    component: SdTicketCallsTab,
    agentOnly: true,
  },
  {
    id: 'tasks',
    label: 'Tarefas',
    icon: Task01Icon,
    component: SdTicketTasksTab,
    agentOnly: true,
    primary: true,
  },
  {
    id: 'hours',
    label: 'Horas',
    icon: Clock01Icon,
    component: SdTicketHoursTab,
    agentOnly: true,
  },
  {
    id: 'costs',
    label: 'Custos',
    icon: Money03Icon,
    component: SdTicketCostsTab,
    agentOnly: true,
  },
  {
    id: 'approvals',
    label: 'Aprovação',
    icon: CheckListIcon,
    component: SdTicketApprovalsTab,
    primary: true,
  },
  {
    id: 'change',
    label: 'Mudança',
    icon: ArrowDataTransferHorizontalIcon,
    component: SdTicketChangeTab,
    agentOnly: true,
    types: ['CHANGE'],
    primary: true,
  },
  {
    id: 'parts',
    label: 'Peças',
    icon: PackageIcon,
    component: SdTicketPartsTab,
    agentOnly: true,
  },
  {
    id: 'children',
    label: 'Itens filhos',
    icon: HierarchyIcon,
    component: SdTicketChildrenTab,
    agentOnly: true,
  },
  {
    id: 'escalation',
    label: 'Escalonamento',
    icon: ArrowUpDoubleIcon,
    component: SdTicketEscalationTab,
    agentOnly: true,
  },
  {
    id: 'swarm',
    label: 'Swarming',
    icon: UserGroupIcon,
    component: SdTicketSwarmTab,
    agentOnly: true,
  },
  {
    id: 'major-incident',
    label: 'Incidente maior',
    icon: FireIcon,
    component: SdTicketMajorIncidentTab,
    agentOnly: true,
  },
  {
    id: 'traceability',
    label: 'Rastreabilidade',
    icon: Route01Icon,
    component: SdTicketTraceabilityTab,
    agentOnly: true,
  },
  {
    id: 'signature',
    label: 'Assinatura',
    icon: SignatureIcon,
    component: SdTicketSignatureTab,
  },
  {
    id: 'knowledge',
    label: 'Conhecimento',
    icon: BookOpen01Icon,
    component: SdTicketKnowledgeTab,
    primary: true,
  },
]

/** Abas visíveis para o modo (agente vê todas). */
export function sdTicketTabsFor(
  mode: SdTicketTabProps['mode'],
  type?: SdTicketTypeDTO,
): SdTicketTabDef[] {
  return SD_TICKET_TABS.filter(
    (t) =>
      (mode === 'agent' || !t.agentOnly) &&
      (!t.types || !type || t.types.includes(type)),
  )
}

/** Aba ativa a partir do `?tab=` (inválida → a primeira). */
export function sdResolveTab(
  tab: string | null | undefined,
  mode: SdTicketTabProps['mode'],
  type?: SdTicketTypeDTO,
): string {
  const tabs = sdTicketTabsFor(mode, type)
  return tabs.find((t) => t.id === tab)?.id ?? tabs[0]?.id ?? 'history'
}

/**
 * Abas da barra x do menu "Mais": as `primary` ficam sempre à vista; a
 * ativa também, mesmo que não seja primária (senão o usuário não vê onde
 * está).
 */
export function sdSplitTicketTabs(
  tabs: SdTicketTabDef[],
  active: string | undefined,
): { visible: SdTicketTabDef[]; overflow: SdTicketTabDef[] } {
  const visible = tabs.filter((t) => t.primary || t.id === active)
  const overflow = tabs.filter((t) => !visible.includes(t))
  return { visible, overflow }
}

/**
 * Barra de abas discreta (só texto) + conteúdo da aba ativa (só a ativa é
 * montada — cada aba busca os próprios dados). As abas secundárias ficam no
 * menu "Mais".
 */
export function SdTicketTabs({
  props,
  active,
  onChange,
  counts = {},
}: {
  props: SdTicketTabProps
  active: string
  onChange: (tab: string) => void
  /** Contadores por id de aba (ex.: `children: 3`). */
  counts?: Record<string, number | undefined>
}) {
  const tabs = sdTicketTabsFor(props.mode, props.ticket.type)
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  const Active = current?.component
  const { visible, overflow } = sdSplitTicketTabs(tabs, current?.id)
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {/* Mesma superfície do painel do workspace (o fundo da tela). */}
      <div className='sticky top-0 z-20 flex shrink-0 items-center gap-1 border-b bg-primary-foreground px-2 sm:px-4'>
        <div
          role='tablist'
          aria-label='Abas do chamado'
          className='no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto'
        >
          {visible.map((tab) => {
            const selected = tab.id === current?.id
            const count = counts[tab.id]
            return (
              <button
                key={tab.id}
                type='button'
                role='tab'
                id={`sd-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`sd-tabpanel-${tab.id}`}
                onClick={() => onChange(tab.id)}
                className={cn(
                  '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2 py-2.5 text-sm outline-none transition-colors focus-visible:text-foreground focus-visible:underline',
                  selected
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                {count ? (
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {count}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {overflow.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='sm'
                  className='shrink-0 font-normal text-muted-foreground'
                  aria-label='Mais abas'
                >
                  Mais
                  <SteelIcon
                    icon={ArrowDown01Icon}
                    strokeWidth={2}
                    className='size-3.5'
                  />
                </Button>
              }
            />
            <DropdownMenuContent align='start' className='w-52'>
              {overflow.map((tab) => {
                const count = counts[tab.id]
                return (
                  <DropdownMenuItem
                    key={tab.id}
                    onClick={() => onChange(tab.id)}
                  >
                    <SteelIcon icon={tab.icon} strokeWidth={2} />
                    {tab.label}
                    {count ? (
                      <span className='ml-auto text-muted-foreground text-xs tabular-nums'>
                        {count}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {current && Active ? (
        <div
          role='tabpanel'
          id={`sd-tabpanel-${current.id}`}
          aria-labelledby={`sd-tab-${current.id}`}
          className='min-h-0 flex-1'
        >
          <Active {...props} />
        </div>
      ) : null}
    </div>
  )
}
