'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { cn } from '@/lib/utils'
import { productLogoFont } from '@/src/lib/landing-page-templates/product/fonts'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type FooterContent = Extract<CrmLandingPageSectionContent, { type: 'FOOTER' }>

export function footerDefaultContent(): FooterContent {
  return {
    type: 'FOOTER',
    logoText: 'Sua Empresa',
    linkGroups: [
      {
        title: 'Legal',
        links: [
          { label: 'Política de Privacidade', href: '#' },
          { label: 'Termos e Condições', href: '#' },
          { label: 'Suporte', href: '#' },
        ],
      },
    ],
    socialLinks: [],
  }
}

/**
 * Fiel ao frame "Footer" — minimalista, uma única linha (logo + links),
 * sem colunas com título nem redes sociais. `linkGroups` do schema suporta
 * várias colunas com título, mas aqui todos os grupos são achatados numa
 * lista inline só (os títulos de grupo não são renderizados) pra bater com
 * o design; a seção colapsa graciosamente quando `linkGroups`/`socialLinks`
 * estão vazios.
 */
export function ProductFooter({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<FooterContent>) {
  function updateLink(
    groupIndex: number,
    linkIndex: number,
    patch: Partial<{ label: string; href: string }>,
  ) {
    onChange?.({
      ...content,
      linkGroups: content.linkGroups.map((g, i) =>
        i === groupIndex
          ? {
              ...g,
              links: g.links.map((l, j) =>
                j === linkIndex ? { ...l, ...patch } : l,
              ),
            }
          : g,
      ),
    })
  }

  function addLink() {
    const groups =
      content.linkGroups.length > 0
        ? content.linkGroups
        : [{ title: 'Legal', links: [] }]
    onChange?.({
      ...content,
      linkGroups: groups.map((g, i) =>
        i === 0
          ? { ...g, links: [...g.links, { label: 'Link', href: '#' }] }
          : g,
      ),
    })
  }

  function removeLink(groupIndex: number, linkIndex: number) {
    onChange?.({
      ...content,
      linkGroups: content.linkGroups.map((g, i) =>
        i === groupIndex
          ? { ...g, links: g.links.filter((_, j) => j !== linkIndex) }
          : g,
      ),
    })
  }

  const flatLinks = content.linkGroups.flatMap((group, groupIndex) =>
    group.links.map((link, linkIndex) => ({ link, groupIndex, linkIndex })),
  )

  return (
    <footer
      id='footer'
      className='mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-4 bg-white px-6 py-8 text-[#161c2d] sm:flex-row sm:px-10 lg:px-[123px]'
    >
      <GhostInput
        value={content.logoText ?? ''}
        onCommit={(v) => onChange?.({ ...content, logoText: v || undefined })}
        placeholder='Nome da marca'
        readOnly={readOnly}
        className={cn(
          productLogoFont.className,
          'font-bold text-[#161c2d] text-[24px]',
        )}
      />

      {flatLinks.length > 0 || !readOnly ? (
        <ul className='flex flex-wrap items-center justify-center gap-x-8 gap-y-2'>
          {flatLinks.map(({ link, groupIndex, linkIndex }) => (
            <li
              key={`${groupIndex}-${linkIndex}`}
              className='group/link flex items-center gap-1'
            >
              <GhostLink
                href={link.href}
                onHrefChange={(href) =>
                  updateLink(groupIndex, linkIndex, { href })
                }
                readOnly={readOnly}
              >
                <GhostInput
                  value={link.label}
                  onCommit={(v) =>
                    updateLink(groupIndex, linkIndex, { label: v })
                  }
                  readOnly={readOnly}
                  className='font-bold text-[#161c2d] text-[15px]'
                />
              </GhostLink>
              {!readOnly ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  className='opacity-0 group-hover/link:opacity-100'
                  aria-label='Remover link'
                  onClick={() => removeLink(groupIndex, linkIndex)}
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} size={12} />
                </Button>
              ) : null}
            </li>
          ))}
          {!readOnly ? (
            <li>
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                aria-label='Adicionar link'
                onClick={addLink}
              >
                <SteelIcon icon={Add01Icon} strokeWidth={2} size={12} />
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </footer>
  )
}
