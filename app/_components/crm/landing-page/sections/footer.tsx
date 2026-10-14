'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from './overrides'
import type { LandingPageSectionProps } from './types'

type FooterContent = Extract<CrmLandingPageSectionContent, { type: 'FOOTER' }>

export function footerDefaultContent(): FooterContent {
  return { type: 'FOOTER', linkGroups: [], socialLinks: [] }
}

export function FooterSection({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<FooterContent>) {
  const links = content.linkGroups[0]?.links ?? []

  function updateLinks(next: { label: string; href: string }[]) {
    const [firstGroup, ...rest] = content.linkGroups
    onChange?.({
      ...content,
      linkGroups: [
        { title: firstGroup?.title ?? 'Links', links: next },
        ...rest,
      ],
    })
  }

  function addLink() {
    updateLinks([...links, { label: 'Link', href: '#' }])
  }

  function updateLink(
    index: number,
    patch: Partial<{ label: string; href: string }>,
  ) {
    updateLinks(links.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeLink(index: number) {
    updateLinks(links.filter((_, i) => i !== index))
  }

  return (
    <footer
      id='footer'
      className='flex flex-col items-center gap-6 border-t px-6 py-12 text-center sm:px-12'
    >
      {content.text || !readOnly ? (
        <GhostInput
          value={content.text ?? ''}
          onCommit={(v) => onChange?.({ ...content, text: v || undefined })}
          placeholder='Chamada final'
          readOnly={readOnly}
          className='max-w-md text-balance font-medium text-lg'
        />
      ) : null}

      <nav className='flex flex-wrap items-center justify-center gap-1 sm:gap-4'>
        {links.map((link, index) => (
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

      <GhostInput
        as='p'
        value={textOf(
          content,
          'copyright',
          `© ${new Date().getFullYear()} — Todos os direitos reservados.`,
        )}
        onCommit={(v) => onChange?.(withText(content, 'copyright', v))}
        readOnly={readOnly}
        className='max-w-md text-center text-muted-foreground text-xs'
      />
    </footer>
  )
}
