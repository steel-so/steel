import type { IconSvgElement } from '@hugeicons/react'
import {
  AiBrain01Icon,
  ApiIcon,
  ClaudeIcon,
  Database01Icon,
  FacebookIcon,
  GithubIcon,
  GitlabIcon,
  GoogleIcon,
  Mail02Icon,
  Megaphone01Icon,
  SlackIcon,
  WebhookIcon,
  WhatsappIcon,
  ZapIcon,
} from '@hugeicons-pro/core-solid-rounded'

export interface MarketplaceIntegration {
  title: string
  description: string
  /** Module(s) that use it, shown as a small label. */
  module: string
  cta: string
  href: string
  icon: IconSvgElement
}

export interface MarketplaceGroup {
  title: string
  integrations: MarketplaceIntegration[]
}

/**
 * Integrations Steel ships today, grouped like the Produto menu. Every entry
 * is a connection that exists in the product — nothing "coming soon".
 */
export const MARKETPLACE_GROUPS: MarketplaceGroup[] = [
  {
    title: 'Comunicação',
    integrations: [
      {
        title: 'WhatsApp Business (Meta)',
        description:
          'Conecte o número pela WhatsApp Cloud API oficial da Meta, com templates aprovados e caixa de entrada em tempo real.',
        module: 'Comunicação · ServiceDesk',
        cta: 'Conhecer a Comunicação',
        href: '/product/comunicacao',
        icon: WhatsappIcon,
      },
      {
        title: 'Z-API',
        description:
          'Conecte o WhatsApp lendo um QR code e comece a atender em minutos, sem passar pela aprovação da Meta.',
        module: 'Comunicação · ServiceDesk',
        cta: 'Conhecer a Comunicação',
        href: '/product/comunicacao',
        icon: ZapIcon,
      },
      {
        title: 'Slack',
        description:
          'Eventos dos chamados no canal do time, com ações direto pelo Slack. Conexão por OAuth, feita em Ajustes > Integrações.',
        module: 'ServiceDesk',
        cta: 'Conhecer o ServiceDesk',
        href: '/product/servicedesk',
        icon: SlackIcon,
      },
    ],
  },
  {
    title: 'Inteligência artificial',
    integrations: [
      {
        title: 'OpenAI',
        description:
          'Modelos da OpenAI para a Steel AI, os Steel Agents, a IA do WhatsApp e o copiloto do ServiceDesk.',
        module: 'Steel AI',
        cta: 'Conhecer a Steel AI',
        href: '/product/steel-ai',
        icon: AiBrain01Icon,
      },
      {
        title: 'Anthropic',
        description:
          'Modelos Claude como alternativa, escolhidos por workspace e por conversa, com o custo real de cada modelo no painel de uso.',
        module: 'Steel AI',
        cta: 'Conhecer a Steel AI',
        href: '/product/steel-ai',
        icon: ClaudeIcon,
      },
    ],
  },
  {
    title: 'Desenvolvimento e monitoramento',
    integrations: [
      {
        title: 'GitHub',
        description:
          'Vincule issues e pull requests a chamados de problema e mudança, ou abra a issue a partir do chamado. O estado volta para o Steel.',
        module: 'ServiceDesk',
        cta: 'Conhecer o ServiceDesk',
        href: '/product/servicedesk',
        icon: GithubIcon,
      },
      {
        title: 'GitLab',
        description:
          'Issues e merge requests vinculados aos chamados, com o estado sincronizado e sugestão de fase ao fechar.',
        module: 'ServiceDesk',
        cta: 'Conhecer o ServiceDesk',
        href: '/product/servicedesk',
        icon: GitlabIcon,
      },
      {
        title: 'Zabbix e webhooks',
        description:
          'Alertas de monitoramento abrem, atualizam e resolvem chamados, ligados ao item de configuração do host.',
        module: 'ServiceDesk',
        cta: 'Conhecer o CMDB',
        href: '/features/cmdb',
        icon: WebhookIcon,
      },
    ],
  },
  {
    title: 'E-mail e marketing',
    integrations: [
      {
        title: 'Gmail e Outlook',
        description:
          'Conecte a conta de e-mail do vendedor para trazer mensagens e eventos de calendário ao CRM.',
        module: 'CRM',
        cta: 'Conhecer o CRM',
        href: '/product/crm',
        icon: GoogleIcon,
      },
      {
        title: 'Caixas IMAP e SMTP',
        description:
          'E-mails que chegam na caixa de suporte viram chamados, e as respostas do time saem pela mesma caixa, encadeadas.',
        module: 'ServiceDesk',
        cta: 'Conhecer o ServiceDesk',
        href: '/product/servicedesk',
        icon: Mail02Icon,
      },
      {
        title: 'Redes sociais',
        description:
          'Facebook, Instagram, TikTok e YouTube no CRM, com publicações e acompanhamento de concorrentes.',
        module: 'CRM',
        cta: 'Conhecer o CRM',
        href: '/product/crm',
        icon: FacebookIcon,
      },
      {
        title: 'Google Ads e Analytics',
        description:
          'Os números das campanhas pagas e do site ao lado do funil, para saber de onde vêm os leads.',
        module: 'CRM',
        cta: 'Conhecer as campanhas',
        href: '/features/campanhas',
        icon: Megaphone01Icon,
      },
    ],
  },
  {
    title: 'Dados e plataforma',
    integrations: [
      {
        title: 'API e chaves de integração',
        description:
          'Chaves por workspace para o seu site ou sistema criar leads no CRM, e a referência da API do Steel.',
        module: 'CRM · Plataforma',
        cta: 'Ler a documentação',
        href: '/docs',
        icon: ApiIcon,
      },
      {
        title: 'PostgreSQL próprio',
        description:
          'Aponte um módulo para o banco PostgreSQL da sua empresa, com credenciais guardadas cifradas.',
        module: 'Plataforma',
        cta: 'Falar com vendas',
        href: '/talk-to-sales',
        icon: Database01Icon,
      },
    ],
  },
]
