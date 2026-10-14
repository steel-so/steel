import type { Metadata } from 'next'
import { connection } from 'next/server'
import { H1 } from '@/components/typography/heading/h1'
import { Muted } from '@/components/typography/text/muted'
import { P } from '@/components/typography/text/p'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  NEXT_PUBLIC_GA_ID,
  NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_SENTRY_DSN,
} from '@/lib/env/env'
import { PRIVACY_VERSION } from '@/lib/legal/versions'
import { isBillingEnabled } from '@/src/lib/billing'
import { publicPageMetadata } from '@/src/lib/seo/metadata'

export const metadata: Metadata = publicPageMetadata({
  title: 'Subprocessadores | Steel',
  description: 'Terceiros que processam dados em nome do Steel.',
  path: '/legals/subprocessors',
})

/**
 * Optional providers are listed only while their key is configured: a
 * provider that processes nothing is not a subprocessor.
 */
type Condition = 'billing' | 'sentry' | 'posthog' | 'analytics'

interface Subprocessor {
  name: string
  purpose: string
  data: string
  location: string
  when?: Condition
}

/** Sentry and PostHog store data in the region their DSN/host points at. */
const sentryLocation = /\.de\.sentry\.io/.test(NEXT_PUBLIC_SENTRY_DSN ?? '')
  ? 'Alemanha (UE)'
  : 'Estados Unidos'
const posthogLocation = NEXT_PUBLIC_POSTHOG_HOST.includes('eu.i.posthog.com')
  ? 'União Europeia'
  : 'Estados Unidos'

const SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'Meta Platforms, Inc.',
    purpose:
      'WhatsApp Business Platform (mensageria), Facebook e Instagram (conexões de redes sociais do CRM)',
    data: 'Mensagens de WhatsApp, contatos, dados de conexão OAuth',
    location: 'Estados Unidos',
  },
  {
    name: 'Z-API',
    purpose: 'Gateway alternativo (não oficial) de WhatsApp',
    data: 'Mensagens de WhatsApp, contatos',
    location: 'Brasil',
  },
  {
    name: '8x8, Inc. (Jitsi Meet)',
    purpose: 'Chamadas de vídeo iniciadas pelo módulo Comunicação',
    data: 'Áudio e vídeo da chamada, nome exibido dos participantes',
    location: 'Estados Unidos',
  },
  {
    name: 'Google LLC',
    purpose:
      'Login social, Google Ads e Google Analytics (conexões de marketing do CRM)',
    data: 'Nome, e-mail (login); dados de campanhas e métricas (Ads/Analytics)',
    location: 'Estados Unidos',
  },
  {
    name: 'Google LLC (Google Analytics no site)',
    purpose:
      'Medição de audiência do site público, só com consentimento de cookies',
    data: 'Páginas visitadas, dados do navegador e do dispositivo, identificador de cookie',
    location: 'Estados Unidos',
    when: 'analytics',
  },
  {
    name: 'GitHub, Inc. (Microsoft)',
    purpose:
      'Login social e integração de repositórios (issues e pull requests vinculados a chamados)',
    data: 'Nome, e-mail (login); título, descrição e status dos chamados vinculados',
    location: 'Estados Unidos',
  },
  {
    name: 'GitLab Inc.',
    purpose:
      'Integração de repositórios no gitlab.com (issues e merge requests vinculados a chamados)',
    data: 'Título, descrição e status dos chamados vinculados',
    location: 'Estados Unidos',
  },
  {
    name: 'Slack Technologies, LLC (Salesforce)',
    purpose: 'Notificações e abertura de chamados pelo Slack (ServiceDesk)',
    data: 'Dados dos chamados (título, solicitante, status), mensagens enviadas ao app',
    location: 'Estados Unidos',
  },
  {
    name: 'TikTok',
    purpose: 'Conexão de rede social do CRM',
    data: 'Dados de conexão OAuth, conteúdo publicado/agendado',
    location: 'Estados Unidos / Singapura',
  },
  {
    name: 'LinkedIn Corporation (Microsoft)',
    purpose: 'Conexão de rede social do CRM',
    data: 'Dados de conexão OAuth, conteúdo publicado/agendado',
    location: 'Estados Unidos',
  },
  {
    name: 'X Corp.',
    purpose: 'Conexão de rede social do CRM',
    data: 'Dados de conexão OAuth, conteúdo publicado/agendado',
    location: 'Estados Unidos',
  },
  {
    name: 'YouTube (Google LLC)',
    purpose: 'Conexão de rede social do CRM',
    data: 'Dados de conexão OAuth, métricas de canal',
    location: 'Estados Unidos',
  },
  {
    name: 'OpenAI, L.L.C.',
    purpose:
      'Recursos de inteligência artificial (Steel AI, resposta automática, análise de sentimento, sugestões de texto)',
    data: 'Conteúdo de conversas, textos e prompts submetidos pelo usuário',
    location: 'Estados Unidos',
  },
  {
    name: 'Anthropic, PBC',
    purpose:
      'Recursos de inteligência artificial (Steel AI, resposta automática, análise de sentimento, sugestões de texto)',
    data: 'Conteúdo de conversas, textos e prompts submetidos pelo usuário',
    location: 'Estados Unidos',
  },
  {
    name: 'AbacatePay',
    purpose: 'Processamento de pagamentos e cobrança de assinaturas',
    data: 'Nome, endereço de cobrança, dados de cartão',
    location: 'Brasil',
    when: 'billing',
  },
  {
    name: 'Resend',
    purpose: 'Envio de e-mails transacionais',
    data: 'Nome, e-mail, conteúdo da mensagem transacional',
    location: 'Estados Unidos',
  },
  {
    name: 'Axiom',
    purpose: 'Observabilidade, logs e auditoria de eventos da plataforma',
    data: 'Logs técnicos, metadados de eventos de auditoria',
    location: 'Estados Unidos',
  },
  {
    name: 'Functional Software, Inc. (Sentry)',
    purpose:
      'Monitoramento de erros da aplicação; no navegador, só com consentimento de cookies',
    data: 'Dados técnicos do erro, endereço da página, navegador e sistema',
    location: sentryLocation,
    when: 'sentry',
  },
  {
    name: 'PostHog, Inc.',
    purpose: 'Análise de uso do produto, só com consentimento de cookies',
    data: 'Páginas visitadas, eventos de uso, identificador do usuário',
    location: posthogLocation,
    when: 'posthog',
  },
  {
    name: 'Open Datacenter Brasil Ltda',
    purpose:
      'Hospedagem da aplicação, banco de dados e armazenamento de arquivos',
    data: 'Todos os dados processados pela plataforma',
    location: 'Brasil',
  },
]

export default async function SubprocessorsPage() {
  // Per request, so the list follows the billing flag without a rebuild.
  await connection()
  const active: Record<Condition, boolean> = {
    billing: isBillingEnabled(),
    sentry: Boolean(NEXT_PUBLIC_SENTRY_DSN),
    posthog: Boolean(NEXT_PUBLIC_POSTHOG_KEY),
    analytics: Boolean(NEXT_PUBLIC_GA_ID),
  }
  const subprocessors = SUBPROCESSORS.filter(
    (sp) => !sp.when || active[sp.when],
  )

  return (
    <main className='mx-auto flex max-w-4xl flex-col gap-6 px-6 py-16'>
      <header className='flex flex-col gap-2 text-left'>
        <H1 className='text-left'>Subprocessadores</H1>
        <Muted>Versão {PRIVACY_VERSION}</Muted>
      </header>

      <P>
        Esta página lista os terceiros ("subprocessadores") que processam dados
        pessoais em nome do Steel, referenciada pela nossa{' '}
        <a href='/legals/privacy' className='underline'>
          Política de Privacidade
        </a>
        . Notificaremos alterações materiais a esta lista conforme descrito lá.
      </P>

      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subprocessador</TableHead>
              <TableHead>Finalidade</TableHead>
              <TableHead>Dados processados</TableHead>
              <TableHead>Localização</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subprocessors.map((sp) => (
              <TableRow key={sp.name}>
                <TableCell className='font-medium'>{sp.name}</TableCell>
                <TableCell>{sp.purpose}</TableCell>
                <TableCell>{sp.data}</TableCell>
                <TableCell>{sp.location}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </main>
  )
}
