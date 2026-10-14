'use client'

import {
  Add01Icon,
  Delete02Icon,
  ShoppingCart01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { cn } from '@/lib/utils'
import { ecommerceLogoFont } from '@/src/lib/landing-page-templates/ecommerce/fonts'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type HeaderContent = Extract<CrmLandingPageSectionContent, { type: 'HEADER' }>

export function headerDefaultContent(): HeaderContent {
  return {
    type: 'HEADER',
    logoText: 'Brainwave.io',
    navLinks: [
      { label: 'Demos', href: '#' },
      { label: 'Pages', href: '#' },
      { label: 'Support', href: '#' },
      { label: 'Contact', href: '#footer' },
    ],
  }
}

/**
 * O frame Figma não tem botão de CTA no header (diferente do Agency) — só
 * logo, nav e um ícone de carrinho com badge. The badge count has no typed
 * field, so it lives in the `texts` override map (slot `cartCount`).
 */
export function EcommerceHeader({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<HeaderContent>) {
  function addLink() {
    onChange?.({
      ...content,
      navLinks: [...content.navLinks, { label: 'Link', href: '#' }],
    })
  }

  function updateLink(
    index: number,
    patch: Partial<{ label: string; href: string }>,
  ) {
    onChange?.({
      ...content,
      navLinks: content.navLinks.map((l, i) =>
        i === index ? { ...l, ...patch } : l,
      ),
    })
  }

  function removeLink(index: number) {
    onChange?.({
      ...content,
      navLinks: content.navLinks.filter((_, i) => i !== index),
    })
  }

  return (
    <header className='relative z-10 mx-auto flex max-w-[1600px] items-center justify-between gap-6 px-6 py-6 sm:px-10 lg:px-[123px]'>
      <GhostInput
        value={content.logoText}
        onCommit={(v) => onChange?.({ ...content, logoText: v })}
        placeholder='Nome da marca'
        readOnly={readOnly}
        className={cn(
          ecommerceLogoFont.className,
          'font-bold text-[#161c2d] text-[24px] tracking-[-0.13px]',
        )}
      />

      <nav className='hidden items-center gap-10 lg:flex'>
        {content.navLinks.map((link, index) => (
          <div
            key={`${link.label}-${index}`}
            className='group/nav-link flex items-center gap-1'
          >
            <GhostLink
              href={link.href}
              onHrefChange={(href) => updateLink(index, { href })}
              readOnly={readOnly}
            >
              <GhostInput
                value={link.label}
                onCommit={(v) => updateLink(index, { label: v })}
                readOnly={readOnly}
                className='font-bold text-[#161c2d] text-[15px] tracking-[-0.1px]'
              />
            </GhostLink>
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='opacity-0 group-hover/nav-link:opacity-100'
                aria-label='Remover link'
                onClick={() => removeLink(index)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
              </Button>
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <Button
            type='button'
            variant='ghost'
            size='icon-xs'
            aria-label='Adicionar link'
            onClick={addLink}
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} size={14} />
          </Button>
        ) : null}
      </nav>

      <div className='relative shrink-0 text-[#161c2d]'>
        <SteelIcon icon={ShoppingCart01Icon} strokeWidth={2} size={20} />
        <span className='-top-2 -right-2 absolute flex size-[18px] items-center justify-center rounded-full bg-[#473bf0] font-bold text-[10px] text-white'>
          <GhostInput
            value={textOf(content, 'cartCount', '2')}
            onCommit={(v) => onChange?.(withText(content, 'cartCount', v))}
            readOnly={readOnly}
            maxLength={3}
            aria-label='Quantidade no carrinho'
            className='mx-0 px-0 text-center'
          />
        </span>
      </div>
    </header>
  )
}
