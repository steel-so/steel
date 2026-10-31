'use client'

import {
  AiMagicIcon,
  Alert02Icon,
  ArrowDataTransferHorizontalIcon,
  BoxIcon,
  Building03Icon,
  CheckListIcon,
  Clock01Icon,
  DollarCircleIcon,
  File02Icon,
  Flowchart01Icon,
  FormIcon,
  HardDriveIcon,
  Layers01Icon,
  Link04Icon,
  Mail01Icon,
  Message01Icon,
  Notification03Icon,
  PieChartIcon,
  RadarIcon,
  RepeatIcon,
  Settings02Icon,
  ShieldKeyIcon,
  Tag01Icon,
  WhatsappIcon,
  WorkflowSquare01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ComponentType } from 'react'
import { SdAiTab } from './ai-tab'
import { SdAutomationsTab } from './automations-tab'
import { SdCannedResponsesTab } from './canned-responses-tab'
import { SdCatalogTab } from './catalog-tab'
import { SdChangesTab } from './changes-tab'
import { SdClassificationsTab } from './classifications-tab'
import { SdContractsTab } from './contracts-tab'
import { SdCustomFieldsTab } from './custom-fields-tab'
import { SdDepartmentsTab } from './departments-tab'
import { SdEscalationTab } from './escalation-tab'
import { SdFlowsTab } from './flows-tab'
import { SdGeneralTab } from './general-tab'
import { SdIntegrationsTab } from './integrations-tab'
import { SdInventoryTab } from './inventory-tab'
import { SdMailSettingsTab } from './mail-tab'
import { SdMonitoringTab } from './monitoring-tab'
import { SdNotificationsTab } from './notifications-tab'
import { SdOnCallTab } from './oncall-tab'
import { SdPartsTab } from './parts-tab'
import { SdPrioritiesTab } from './priorities-tab'
import { SdRecurringTab } from './recurring-tab'
import { SdReportsTab } from './reports-tab'
import { SdSlaTab } from './sla-tab'
import { SdTemplatesTab } from './templates-tab'
import { SdWhatsappSettingsTab } from './whatsapp-tab'

/**
 * Registro das abas de `/[slug]/servicedesk/settings`. Para adicionar uma
 * aba (ex.: "WhatsApp" da fatia whatsapp-ai), acrescente uma entrada aqui:
 * o componente lê `workspaceId`, `canEdit` e o bootstrap via
 * `useSdSettingsContext()` (`./sd-settings-kit`). A ordem da lista é a ordem das
 * abas; `id` vira o `?tab=` da URL.
 */
export interface SdSettingsTabDefinition {
  id: string
  label: string
  /** Ícone Hugeicons (`@hugeicons-pro/core-stroke-rounded`). */
  icon: typeof Settings02Icon
  /** Frase curta exibida no topo da aba. */
  description: string
  component: ComponentType
  /**
   * Aba de preferências **do usuário**, não do workspace: todo mundo edita
   * as suas, então o aviso de "modo leitura" dos não-admins não se aplica.
   */
  personal?: boolean
}

export const SD_SETTINGS_TABS: SdSettingsTabDefinition[] = [
  {
    id: 'general',
    label: 'Geral',
    icon: Settings02Icon,
    description:
      'Prefixos, padrões, portal do solicitante, exigências e ciclo de vida do chamado.',
    component: SdGeneralTab,
  },
  {
    id: 'departments',
    label: 'Departamentos',
    icon: Building03Icon,
    description:
      'Times que atendem (até dois níveis), seus membros e líderes. Quem está em um departamento é agente.',
    component: SdDepartmentsTab,
  },
  {
    id: 'flows',
    label: 'Fluxos',
    icon: Flowchart01Icon,
    description:
      'Fases por tipo de chamado (kanban), % de conclusão, pausa de SLA, aprovação, campos obrigatórios e transições.',
    component: SdFlowsTab,
  },
  {
    id: 'catalog',
    label: 'Catálogo',
    icon: Layers01Icon,
    description:
      'Catálogo de serviços: categoria > subcategoria > serviço, com time e SLA padrão.',
    component: SdCatalogTab,
  },
  {
    id: 'classifications',
    label: 'Classificações',
    icon: Tag01Icon,
    description: 'Classificações do chamado e da solução.',
    component: SdClassificationsTab,
  },
  {
    id: 'priorities',
    label: 'Prioridades',
    icon: Alert02Icon,
    description:
      'Impacto, urgência, prioridade, severidade e a matriz impacto × urgência.',
    component: SdPrioritiesTab,
  },
  {
    id: 'sla',
    label: 'SLA',
    icon: Clock01Icon,
    description:
      'Políticas de SLA/OLA com metas por prioridade e calendários de expediente com feriados.',
    component: SdSlaTab,
  },
  {
    id: 'escalation',
    label: 'Escalonamento',
    icon: WorkflowSquare01Icon,
    description:
      'Regras automáticas de escalonamento funcional e hierárquico disparadas pelo SLA.',
    component: SdEscalationTab,
  },
  {
    id: 'oncall',
    label: 'Plantão',
    icon: ShieldKeyIcon,
    description:
      'Escalas de plantão (on-call): camadas (primeira chamada, retaguarda…), rodízio dos participantes, trocas pontuais e a linha do tempo das próximas duas semanas. Fora do expediente, o escalonamento chama quem está de plantão.',
    component: SdOnCallTab,
  },
  {
    id: 'automations',
    label: 'Automações',
    icon: CheckListIcon,
    description: 'Evento → condições → ações, na ordem da lista.',
    component: SdAutomationsTab,
  },
  {
    id: 'changes',
    label: 'Mudanças',
    icon: ArrowDataTransferHorizontalIcon,
    description:
      'Janelas do calendário de mudanças (manutenção e congelamento, com repetição e alvo por item de configuração ou departamento) e comitês de mudança (CAB) com membros, votos obrigatórios, quórum e seleção por condições.',
    component: SdChangesTab,
  },
  {
    id: 'custom-fields',
    label: 'Campos customizados',
    icon: FormIcon,
    description:
      'Campos extras para chamados, clientes, contatos e itens de configuração.',
    component: SdCustomFieldsTab,
  },
  {
    id: 'templates',
    label: 'Modelos',
    icon: File02Icon,
    description:
      'Modelos de chamado com valores padrão e checklist de tarefas (requisições e mudanças padrão).',
    component: SdTemplatesTab,
  },
  {
    id: 'recurring',
    label: 'Recorrentes',
    icon: RepeatIcon,
    description:
      'Rotinas que abrem chamado sozinhas (manutenção preventiva, limpeza, backup, vistoria): agenda no fuso da regra, pré-visualização das próximas ocorrências e histórico do que abriu, pulou ou falhou.',
    component: SdRecurringTab,
  },
  {
    id: 'canned-responses',
    label: 'Respostas prontas',
    icon: Message01Icon,
    description: 'Textos prontos para o histórico e o WhatsApp do chamado.',
    component: SdCannedResponsesTab,
  },
  {
    id: 'parts',
    label: 'Peças',
    icon: BoxIcon,
    description: 'Catálogo de peças e custos unitários.',
    component: SdPartsTab,
  },
  {
    id: 'contracts',
    label: 'Contratos',
    icon: DollarCircleIcon,
    description:
      'Contratos de atendimento: franquia de horas, valor da hora, arredondamento, mínimo por chamado, regras de valor (tipo × prioridade × janela) e o histórico de períodos com consumo e excedente.',
    component: SdContractsTab,
  },
  {
    id: 'reports',
    label: 'Relatórios',
    icon: PieChartIcon,
    description:
      'Relatórios de SLA agendados: recorte (clientes, departamentos, tipos), período apurado, formatos (PDF/CSV), dia, hora e fuso do envio, destinatários — e o histórico de execuções com os arquivos para baixar.',
    component: SdReportsTab,
  },
  {
    id: 'monitoring',
    label: 'Monitoramento',
    icon: RadarIcon,
    description:
      'Origens que abrem chamado sozinhas (Zabbix ou webhook genérico): URL com token, mapa severidade → prioridade, encerramento automático na normalização e alertas recebidos.',
    component: SdMonitoringTab,
  },
  {
    id: 'inventory',
    label: 'Inventário',
    icon: HardDriveIcon,
    description:
      'Agente de inventário para Linux (tokens por workspace), varredura SNMP de faixas de rede, limiares de alerta de disco e memória e a sincronização com a CMDB.',
    component: SdInventoryTab,
  },
  {
    id: 'mail',
    label: 'E-mail',
    icon: Mail01Icon,
    description:
      'Caixas de e-mail monitoradas por IMAP: abertura e resposta de chamado por e-mail, padrões, listas de remetentes e confirmação de abertura.',
    component: SdMailSettingsTab,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: WhatsappIcon,
    description:
      'Conexões de WhatsApp do ServiceDesk (Z-API ou Meta), conexão ativa, teste das credenciais e a URL do webhook.',
    component: SdWhatsappSettingsTab,
  },
  {
    id: 'integrations',
    label: 'Integrações',
    icon: Link04Icon,
    description:
      'Slack e GitHub: canal por time para os eventos escolhidos, abertura de chamado a partir de uma mensagem do Slack com a thread espelhada no histórico, e vínculo de issues/PRs com chamados de problema e mudança (estado espelhado por webhook).',
    component: SdIntegrationsTab,
  },
  {
    id: 'notifications',
    label: 'Notificações',
    icon: Notification03Icon,
    description:
      'Suas preferências de aviso (evento × canal), só para você: no app, por e-mail e por WhatsApp. Inclui o resumo diário.',
    component: SdNotificationsTab,
    personal: true,
  },
  {
    id: 'ai',
    label: 'IA',
    icon: AiMagicIcon,
    description:
      'Agente de IA: pré-atendimento, triagem automática, persona e instruções.',
    component: SdAiTab,
  },
]
