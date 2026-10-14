'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from './types'

type HeaderContent = Extract<CrmLandingPageSectionContent, { type: 'HEADER' }>

export function headerDefaultContent(): HeaderContent {
  return {
    type: 'HEADER',
    logoText: 'Sua marca',
    navLinks: [],
    ctaLabel: 'Fale conosco',
    ctaHref: '#footer',
  }
}

export function HeaderSection({
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
    <header className='flex flex-wrap items-center justify-between gap-4 px-6 py-4 sm:px-10'>
      <GhostInput
        value={content.logoText}
        onCommit={(v) => onChange?.({ ...content, logoText: v })}
        placeholder='Nome da marca'
        readOnly={readOnly}
        className='font-semibold text-lg'
      />

      <nav className='flex flex-wrap items-center gap-1 sm:gap-4'>
        {content.navLinks.map((link, index) => (
          <div
            key={`${link.label}-${index}`}
            className='group/nav-link flex items-center gap-1'
          >
            <GhostLink
              href={link.href}
              onHrefChange={(href) => updateLink(index, { href })}
              readOnly={readOnly}
              className='text-muted-foreground text-sm hover:text-foreground'
            >
              <GhostInput
                value={link.label}
                onCommit={(v) => updateLink(index, { label: v })}
                readOnly={readOnly}
                className='text-inherit'
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

      {content.ctaLabel || !readOnly ? (
        <GhostLink
          href={content.ctaHref}
          onHrefChange={(href) =>
            onChange?.({ ...content, ctaHref: href || undefined })
          }
          readOnly={readOnly}
          data-cta
          className='inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 font-medium text-primary-foreground text-sm'
        >
          <GhostInput
            value={content.ctaLabel ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, ctaLabel: v || undefined })
            }
            placeholder='Texto do botão'
            readOnly={readOnly}
            className='text-inherit'
          />
        </GhostLink>
      ) : null}
    </header>
  )
}
