import {
  ApiIcon,
  ArrowRight01Icon,
  CommandLineIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { JsonLd } from '@/components/seo/json-ld'
import { DEV_API_HREF, getDevNav } from '@/src/lib/dev/pages'
import { DEV_SECTIONS } from '@/src/lib/dev/sections'
import { publicPageMetadata } from '@/src/lib/seo/metadata'
import { SITE_URL } from '@/src/lib/seo/site'

const TITLE = 'Desenvolvedores | Steel'
const DESCRIPTION =
  'Guias e referência da API do Steel: API pública v1, token pessoal, Steel CLI, SDK TypeScript, formato de resposta, erros, limites, webhooks e exemplos completos para integrar seus sistemas.'

export const metadata: Metadata = publicPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/dev',
})

/** What an outside system can do with Steel today, and how it gets in. */
const INTEGRATIONS = [
  {
    title: 'Automatizar pelo terminal e no CI',
    access: 'Token pessoal (Steel CLI)',
    route: 'steel login · /api/v1/...',
    href: '/dev/cli',
  },
  {
    title: 'Usar a API v1 no seu código TypeScript',
    access: 'Token pessoal (SDK @steel-so/sdk)',
    route: 'npm install @steel-so/sdk',
    href: '/dev/sdk',
  },
  {
    title: 'Criar leads no CRM',
    access: 'Chave de API (Bearer)',
    route: 'POST /api/crm/integrations/leads',
    href: '/dev/guias/criar-lead',
  },
  {
    title: 'Enviar formulários do CRM',
    access: 'Token público do formulário',
    route: 'POST /api/crm/forms/<token>/submit',
    href: '/dev/guias/criar-lead',
  },
  {
    title: 'Disparar workflows do CRM',
    access: 'Token do gatilho na URL',
    route: 'POST /api/crm/workflows/<token>/trigger',
    href: '/dev/guias/disparar-workflow',
  },
  {
    title: 'Abrir chamados no ServiceDesk',
    access: 'Token da origem na URL',
    route: 'POST /api/servicedesk/monitoring/<token>',
    href: '/dev/guias/abrir-chamado',
  },
  {
    title: 'Receber eventos do GitHub e do GitLab',
    access: 'Assinatura HMAC ou secret token',
    route: 'POST /api/integrations/github/webhook',
    href: '/dev/guias/eventos-github-gitlab',
  },
  {
    title: 'Receber os eventos do Steel no seu sistema',
    access: 'Assinatura Steel-Signature (HMAC)',
    route: 'POST <url do seu sistema>',
    href: '/dev/webhooks#webhooks-que-o-steel-envia',
  },
  {
    title: 'Conectar Claude, ChatGPT e Cursor',
    access: 'OAuth do Steel (servidor MCP)',
    route: 'POST /api/mcp',
    href: '/dev/mcp',
  },
  {
    title: 'Receber mensagens do WhatsApp',
    access: 'Assinatura da Meta ou segredo da Z-API',
    route: 'POST /api/whatsapp/webhook/meta',
    href: '/dev/webhooks',
  },
] as const

export default async function DevIndexPage() {
  const nav = await getDevNav()
  const guides = DEV_SECTIONS.map((section) => ({
    ...section,
    pages: nav.find((group) => group.slug === section.slug)?.pages ?? [],
  })).filter((section) => section.pages.length > 0)

  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/dev`,
    inLanguage: 'pt-BR',
    about: {
      '@type': 'WebAPI',
      name: 'API do Steel',
      documentation: `${SITE_URL}${DEV_API_HREF}`,
      provider: { '@type': 'Organization', name: 'Stratus Telecom' },
    },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: guides
        .flatMap((section) => section.pages)
        .map((page, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${SITE_URL}${page.href}`,
          name: page.title,
        })),
    },
  }

  return (
    <main className='flex flex-col gap-12 py-10 lg:py-16 lg:pr-8'>
      <JsonLd data={collectionSchema} />
      <header className='flex max-w-3xl flex-col gap-4'>
        <span className='text-sm text-muted-foreground'>Desenvolvedores</span>
        <h1 className='text-4xl font-normal sm:text-5xl'>
          Integre seus sistemas ao Steel
        </h1>
        <p className='text-lg text-muted-foreground'>
          Guias para quem conecta um site, um ERP, uma ferramenta de
          monitoramento ou um repositório ao Steel, ou automatiza pelo terminal
          com o Steel CLI e o SDK: como autenticar, o formato das respostas, os
          erros, os limites e exemplos completos que rodam contra a API de
          verdade. A referência lista cada rota.
        </p>
        <div className='flex flex-wrap gap-3 pt-2'>
          <Link
            href='/dev/comecando'
            className='inline-flex h-9 items-center gap-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90'
          >
            Começar
            <SteelIcon icon={ArrowRight01Icon} size={16} />
          </Link>
          <Link
            href={DEV_API_HREF}
            className='inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-card'
          >
            <SteelIcon icon={ApiIcon} size={16} />
            Referência da API
          </Link>
          <Link
            href='/dev/cli'
            className='inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-card'
          >
            <SteelIcon icon={CommandLineIcon} size={16} />
            Steel CLI
          </Link>
        </div>
      </header>

      <section
        aria-labelledby='dev-o-que-integrar'
        className='flex flex-col gap-4'
      >
        <h2 id='dev-o-que-integrar' className='text-2xl font-normal'>
          O que dá para integrar
        </h2>
        <ul className='grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3'>
          {INTEGRATIONS.map((item) => (
            <li key={item.title}>
              <Link
                href={item.href}
                className='flex h-full flex-col gap-2 rounded-xl border border-border p-4 transition-colors hover:bg-card'
              >
                <span className='font-medium'>{item.title}</span>
                <span className='text-sm text-muted-foreground'>
                  {item.access}
                </span>
                <code className='break-all text-xs text-muted-foreground'>
                  {item.route}
                </code>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby='dev-endereco-base'
        className='flex max-w-3xl flex-col gap-3'
      >
        <h2 id='dev-endereco-base' className='text-2xl font-normal'>
          Endereço base e ambientes
        </h2>
        <p className='text-muted-foreground'>
          Todas as rotas ficam sob <code>/api</code>, no mesmo endereço em que a
          sua equipe acessa o Steel. Neste ambiente, o endereço base é{' '}
          <code className='break-all'>{`${SITE_URL}/api`}</code>. Os exemplos
          dos guias usam a variável <code>STEEL_URL</code> para você trocar de
          ambiente sem mexer no código.
        </p>
        <div className='overflow-x-auto rounded-xl border border-border'>
          <table className='w-full text-left text-sm'>
            <thead className='text-muted-foreground'>
              <tr>
                <th scope='col' className='px-4 py-2 font-medium'>
                  Ambiente
                </th>
                <th scope='col' className='px-4 py-2 font-medium'>
                  Endereço base
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className='border-t border-border'>
                <td className='px-4 py-2'>Homologação</td>
                <td className='px-4 py-2'>
                  <code className='break-all text-xs'>
                    https://homologacao.stratustelecom.com.br/api
                  </code>
                </td>
              </tr>
              <tr className='border-t border-border'>
                <td className='px-4 py-2'>Produção</td>
                <td className='px-4 py-2 text-muted-foreground'>
                  O endereço do seu Steel, seguido de <code>/api</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className='text-sm text-muted-foreground'>
          Chaves, tokens e dados são de cada ambiente: uma chave criada em
          homologação não funciona em produção.
        </p>
      </section>

      <section
        aria-labelledby='dev-guias'
        className='grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3'
      >
        <h2 id='dev-guias' className='sr-only'>
          Guias
        </h2>
        {guides.map((section) => (
          <div
            key={section.slug}
            className='flex flex-col gap-4 rounded-xl border border-border p-5'
          >
            <div className='flex flex-col gap-1'>
              <h3 className='text-lg font-medium'>
                <Link href={section.pages[0].href} className='hover:underline'>
                  {section.label}
                </Link>
              </h3>
              <p className='text-sm text-muted-foreground'>
                {section.description}
              </p>
            </div>
            <ul className='flex flex-col gap-1.5 text-sm'>
              {section.pages.map((page) => (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    className='text-muted-foreground transition-colors hover:text-primary'
                  >
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <Link
        href={DEV_API_HREF}
        className='flex max-w-3xl items-center justify-between gap-4 rounded-xl border border-border p-5 transition-colors hover:bg-card'
      >
        <span className='flex gap-3'>
          <SteelIcon icon={ApiIcon} size={24} className='mt-0.5 shrink-0' />
          <span className='flex flex-col gap-1'>
            <span className='text-lg font-medium'>Referência da API</span>
            <span className='text-sm text-muted-foreground'>
              Rotas, parâmetros, respostas e erros, gerados a partir do código.
            </span>
          </span>
        </span>
        <SteelIcon icon={ArrowRight01Icon} size={18} className='shrink-0' />
      </Link>

      <p className='max-w-3xl text-sm text-muted-foreground'>
        Procurando como usar o Steel no dia a dia? Veja o{' '}
        <Link href='/docs' className='text-primary underline'>
          manual do usuário
        </Link>
        . Dúvidas sobre a integração:{' '}
        <a
          href='mailto:suporte@stratustelecom.com.br'
          className='text-primary underline'
        >
          suporte@stratustelecom.com.br
        </a>
        .
      </p>
    </main>
  )
}
