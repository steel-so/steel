'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { cn } from '@/lib/utils'
import { consultationLogoFont } from '@/src/lib/landing-page-templates/consultation/fonts'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type HeaderContent = Extract<CrmLandingPageSectionContent, { type: 'HEADER' }>

export function consultationHeaderDefaultContent(): HeaderContent {
  return {
    type: 'HEADER',
    logoText: 'shadepro',
    navLinks: [
      { label: 'Demos', href: '#' },
      { label: 'Páginas', href: '#' },
      { label: 'Suporte', href: '#' },
      { label: 'Contato', href: '#footer' },
    ],
    ctaLabel: 'Comece agora',
    ctaHref: '#footer',
  }
}

/**
 * No Figma o cabeçalho fica sobreposto à foto do Hero (fundo transparente,
 * texto branco). O construtor renderiza cada seção dentro do seu próprio
 * card (ver `crm-landing-page-builder.tsx`), então a sobreposição real só
 * faz sentido visualmente entre seções vizinhas soltas — aqui replicamos a
 * identidade visual (fundo escuro sólido, texto branco) em vez de depender
 * de um truque de posicionamento entre seções.
 */
export function ConsultationHeader({
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
    <header className='bg-[#161c2d] px-6 py-4 sm:px-10 lg:px-[123px]'>
      <div className='mx-auto flex max-w-[1600px] items-center justify-between gap-6'>
        <GhostInput
          value={content.logoText}
          onCommit={(v) => onChange?.({ ...content, logoText: v })}
          placeholder='Nome da marca'
          readOnly={readOnly}
          className={cn(
            consultationLogoFont.className,
            'font-bold text-[28px] text-white tracking-[-0.16px]',
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
                  className='font-bold text-[15px] text-white tracking-[-0.1px]'
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
            className='inline-flex shrink-0 items-center justify-center rounded-lg bg-[#473bf0] px-6 py-3 font-bold text-[15px] text-white tracking-[-0.5px] transition-opacity hover:opacity-90'
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
      </div>
    </header>
  )
}
