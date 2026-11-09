import {
  AiMagicIcon,
  Archive02Icon,
  BotIcon,
  Call02Icon,
  Clock01Icon,
  Invoice01Icon,
  MessageMultiple01Icon,
  WebDesign01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { WhatsappSettingsAi } from './whatsapp-settings-ai'
import { WhatsappSettingsAiKnowledge } from './whatsapp-settings-ai-knowledge'
import { WhatsappSettingsArchive } from './whatsapp-settings-archive'
import { WhatsappSettingsBoleto } from './whatsapp-settings-boleto'
import { WhatsappSettingsBusinessHours } from './whatsapp-settings-business-hours'
import { WhatsappSettingsCallRecording } from './whatsapp-settings-call-recording'
import { WhatsappSettingsCloseStatuses } from './whatsapp-settings-close-statuses'
import { WhatsappSettingsCopilot } from './whatsapp-settings-copilot'
import { WhatsappSettingsDistribution } from './whatsapp-settings-distribution'
import { WhatsappSettingsNumberCheck } from './whatsapp-settings-number-check'
import { WhatsappSettingsPix } from './whatsapp-settings-pix'
import { WhatsappSettingsService } from './whatsapp-settings-service'
import { WhatsappSettingsSla } from './whatsapp-settings-sla'
import { WhatsappSettingsVoiceAgent } from './whatsapp-settings-voice-agent'
import { WhatsappSettingsWidget } from './whatsapp-settings-widget'

type IconType = Parameters<
  typeof import('@/components/icon/icon').SteelIcon
>[0]['icon']

export interface ZapSettingsSection {
  id: string
  label: string
  group: string
  icon: IconType
  description: string
  render: (workspaceId: string) => ReactNode
}

/**
 * Comunicação settings, one route per section (`/zap/configuracoes/<id>`).
 * The WhatsApp connections themselves (Meta Cloud API, Z-API, Meta channels)
 * are an integration and live in Ajustes › Integrações › WhatsApp.
 */
export const ZAP_SETTINGS_SECTIONS: ZapSettingsSection[] = [
  {
    id: 'service',
    label: 'Atendimento',
    group: 'Atendimento',
    icon: MessageMultiple01Icon,
    description: 'Regras gerais do atendimento e distribuição das conversas.',
    render: (id) => (
      <div className='space-y-6'>
        <WhatsappSettingsService workspaceId={id} />
        <WhatsappSettingsDistribution workspaceId={id} />
        <WhatsappSettingsCloseStatuses workspaceId={id} />
      </div>
    ),
  },
  {
    id: 'hours-sla',
    label: 'Horário e SLA',
    group: 'Atendimento',
    icon: Clock01Icon,
    description: 'Horário de atendimento e metas de primeira resposta.',
    render: (id) => (
      <div className='space-y-6'>
        <WhatsappSettingsBusinessHours workspaceId={id} />
        <WhatsappSettingsSla workspaceId={id} />
      </div>
    ),
  },
  {
    id: 'billing',
    label: 'Cobranças',
    group: 'Atendimento',
    icon: Invoice01Icon,
    description: 'Pix e boleto enviados na conversa.',
    render: (id) => (
      <div className='space-y-6'>
        <WhatsappSettingsPix workspaceId={id} />
        <WhatsappSettingsBoleto workspaceId={id} />
      </div>
    ),
  },
  {
    id: 'contacts',
    label: 'Contatos e arquivo',
    group: 'Atendimento',
    icon: Archive02Icon,
    description: 'Verificação de números e arquivamento de conversas.',
    render: (id) => (
      <div className='space-y-6'>
        <WhatsappSettingsNumberCheck workspaceId={id} />
        <WhatsappSettingsArchive workspaceId={id} />
      </div>
    ),
  },
  {
    id: 'ai',
    label: 'IA e conhecimento',
    group: 'Inteligência',
    icon: AiMagicIcon,
    description: 'Resposta automática, copiloto e base de conhecimento.',
    render: (id) => (
      <div className='space-y-6'>
        <WhatsappSettingsAi workspaceId={id} />
        <WhatsappSettingsCopilot workspaceId={id} />
        <WhatsappSettingsAiKnowledge workspaceId={id} />
      </div>
    ),
  },
  {
    id: 'voice',
    label: 'Atendente de voz',
    group: 'Inteligência',
    icon: BotIcon,
    description: 'Agente de voz que atende as ligações.',
    render: (id) => <WhatsappSettingsVoiceAgent workspaceId={id} />,
  },
  {
    id: 'calls',
    label: 'Gravação de chamadas',
    group: 'Inteligência',
    icon: Call02Icon,
    description: 'Gravação e retenção das ligações.',
    render: (id) => <WhatsappSettingsCallRecording workspaceId={id} />,
  },
  {
    id: 'widget',
    label: 'Chat do site',
    group: 'Canais',
    icon: WebDesign01Icon,
    description: 'Widget de chat para incorporar no seu site.',
    render: (id) => <WhatsappSettingsWidget workspaceId={id} />,
  },
]
