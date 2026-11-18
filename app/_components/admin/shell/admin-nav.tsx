'use client'

import {
  Analytics01Icon,
  ArrowLeft01Icon,
  Building03Icon,
  ChartHistogramIcon,
  DashboardSquare01Icon,
  DatabaseSync01Icon,
  MailAtSign01Icon,
  QrCodeIcon,
  SparklesIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

type IconType = Parameters<typeof SteelIcon>[0]['icon']

interface NavEntry {
  href: string
  label: string
  icon: IconType
  /** Só a própria rota (a visão geral não "acende" nas filhas). */
  exact?: boolean
  soon?: boolean
}

export const ADMIN_NAV: { title: string; items: NavEntry[] }[] = [
  {
    title: 'Plataforma',
    items: [
      {
        href: '/admin',
        label: 'Visão geral',
        icon: DashboardSquare01Icon,
        exact: true,
      },
      { href: '/admin/workspaces', label: 'Workspaces', icon: Building03Icon },
      { href: '/admin/metrics', label: 'Métricas', icon: ChartHistogramIcon },
      { href: '/admin/backups', label: 'Backups', icon: DatabaseSync01Icon },
      { href: '/admin/ai', label: 'Steel IA', icon: SparklesIcon },
    ],
  },
  {
    title: 'Comunicação',
    items: [
      {
        href: '/admin/zapi-line',
        label: 'Linha de verificação',
        icon: QrCodeIcon,
      },
      { href: '/admin/changelog', label: 'Changelog', icon: MailAtSign01Icon },
    ],
  },
  {
    title: 'Observabilidade',
    items: [
      { href: '/admin/analytics', label: 'Analytics', icon: Analytics01Icon },
    ],
  },
]

export function isNavActive(pathname: string, entry: NavEntry): boolean {
  if (entry.exact) return pathname === entry.href
  return pathname === entry.href || pathname.startsWith(`${entry.href}/`)
}

function SoonTag() {
  return (
    <span className='ml-auto rounded border border-border px-1 py-px font-mono text-[10px] text-muted-foreground uppercase tracking-wide'>
      em breve
    </span>
  )
}

/** Navegação lateral (≥ md). */
export function AdminSidebarNav() {
  const pathname = usePathname()

  return (
    <nav aria-label='Admin' className='flex h-full flex-col gap-5'>
      {ADMIN_NAV.map((group) => (
        <div key={group.title} className='space-y-1'>
          <p className='px-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider'>
            {group.title}
          </p>
          <ul className='space-y-0.5'>
            {group.items.map((item) => {
              if (item.soon) {
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled='true'
                      className='flex h-8 cursor-not-allowed items-center gap-2 rounded-md px-2 text-muted-foreground/70 text-sm'
                    >
                      <SteelIcon icon={item.icon} size={16} strokeWidth={2} />
                      {item.label}
                      <SoonTag />
                    </span>
                  </li>
                )
              }
              const active = isNavActive(pathname, item)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors',
                      active
                        ? 'bg-secondary font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <SteelIcon icon={item.icon} size={16} strokeWidth={2} />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      <Link
        href='/'
        className='mt-auto flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground text-sm hover:bg-muted hover:text-foreground'
      >
        <SteelIcon icon={ArrowLeft01Icon} size={16} strokeWidth={2} />
        Voltar ao app
      </Link>
    </nav>
  )
}

/** Navegação em faixa rolável horizontal (< md), sem estourar a largura. */
export function AdminMobileNav() {
  const pathname = usePathname()
  const items = ADMIN_NAV.flatMap((group) => group.items).filter(
    (item) => !item.soon,
  )

  return (
    <nav
      aria-label='Admin'
      className='-mx-4 flex gap-1 overflow-x-auto px-4 pb-px [scrollbar-width:none]'
    >
      {items.map((item) => {
        const active = isNavActive(pathname, item)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
              active
                ? 'bg-secondary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <SteelIcon icon={item.icon} size={15} strokeWidth={2} />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
