'use client'

import {
  AiBrain01Icon,
  Analytics01Icon,
  BrainIcon,
  CheckmarkBadge01Icon,
  ChartLineData01Icon,
  MagicWand01Icon,
  TestTube01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

type IconType = Parameters<typeof SteelIcon>[0]['icon']

export const STEEL_AI_AREA_LINKS: {
  segment: string
  label: string
  icon: IconType
}[] = [
  { segment: 'skills', label: 'Skills', icon: MagicWand01Icon },
  { segment: 'agents', label: 'Agentes', icon: AiBrain01Icon },
  { segment: 'usage', label: 'Uso', icon: ChartLineData01Icon },
  { segment: 'analytics', label: 'Análises', icon: Analytics01Icon },
  { segment: 'evals', label: 'Avaliações', icon: TestTube01Icon },
  { segment: 'qualidade', label: 'Qualidade', icon: CheckmarkBadge01Icon },
  { segment: 'memory', label: 'Memória', icon: BrainIcon },
]

/**
 * Areas of Steel AI (Skills, Agentes, Uso, Análises, Avaliações, Memória), shown above
 * the chat history in the context sidebar — and, through it, in the mobile
 * navigation drawer.
 */
export function SteelAiAreaNav({ slug }: { slug: string }) {
  const pathname = usePathname()
  return (
    <nav aria-label='Áreas do Steel AI' className='space-y-0.5'>
      {STEEL_AI_AREA_LINKS.map((link) => {
        const href = `/${slug}/ai/${link.segment}`
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={link.segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted',
              active ? 'bg-secondary font-medium' : 'text-muted-foreground',
            )}
          >
            <SteelIcon icon={link.icon} strokeWidth={2} className='size-4' />
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
