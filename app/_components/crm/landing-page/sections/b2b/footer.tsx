'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { cn } from '@/lib/utils'
import { b2bLogoFont } from '@/src/lib/landing-page-templates/b2b/fonts'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type FooterContent = Extract<CrmLandingPageSectionContent, { type: 'FOOTER' }>

const BASE = '/landing-page-templates/b2b'

const SOCIAL_ICONS: Record<string, string> = {
  twitter: `${BASE}/social-twitter.svg`,
  facebook: `${BASE}/social-facebook.svg`,
  instagram: `${BASE}/social-instagram.svg`,
  linkedin: `${BASE}/social-linkedin.svg`,
}

export function footerDefaultContent(): FooterContent {
  return {
    type: 'FOOTER',
    logoText: 'Brainwave.io',
    text: 'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    // O bloco "CTA" do Figma ("Ready to get started?" + botão) fica fundido
    // aqui, como orienta a task — FOOTER já modela um CTA opcional.
    ctaTitle: 'Ready to get started?',
    ctaLabel: 'Get A Free Quote',
    ctaHref: '#',
    linkGroups: [
      {
        title: 'Company',
        links: [
          { label: 'About us', href: '#' },
          { label: 'Contact us', href: '#' },
          { label: 'Careers', href: '#' },
          { label: 'Press', href: '#' },
        ],
      },
      {
        title: 'Product',
        links: [
          { label: 'Features', href: '#' },
          { label: 'Pricing', href: '#' },
          { label: 'News', href: '#' },
          { label: 'Help desk', href: '#' },
          { label: 'Support', href: '#' },
        ],
      },
      {
        title: 'Services',
        links: [
          { label: 'Digital Marketing', href: '#' },
          { label: 'Content Writing', href: '#' },
          { label: 'SEO for Business', href: '#' },
          { label: 'UI Design', href: '#' },
        ],
      },
      {
        title: 'Legal',
        links: [
          { label: 'Privacy Policy', href: '#' },
          { label: 'Terms & Conditions', href: '#' },
          { label: 'Return Policy', href: '#' },
        ],
      },
    ],
    socialLinks: [
      { platform: 'twitter', href: '#' },
      { platform: 'facebook', href: '#' },
      { platform: 'instagram', href: '#' },
      { platform: 'linkedin', href: '#' },
    ],
  }
}

export function B2bFooter({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<FooterContent>) {
  function updateGroupTitle(groupIndex: number, title: string) {
    onChange?.({
      ...content,
      linkGroups: content.linkGroups.map((g, i) =>
        i === groupIndex ? { ...g, title } : g,
      ),
    })
  }

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

  function addLink(groupIndex: number) {
    onChange?.({
      ...content,
      linkGroups: content.linkGroups.map((g, i) =>
        i === groupIndex
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

  function updateSocialLink(index: number, href: string) {
    onChange?.({
      ...content,
      socialLinks: content.socialLinks.map((s, i) =>
        i === index ? { ...s, href } : s,
      ),
    })
  }

  return (
    <footer id='footer'>
      {content.ctaTitle || content.ctaLabel || !readOnly ? (
        <div className='bg-[#68d585] px-6 py-12 sm:px-10 lg:px-[123px]'>
          <div className='mx-auto flex max-w-6xl flex-col items-center justify-center gap-6 sm:flex-row'>
            <GhostInput
              as='h2'
              value={content.ctaTitle ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, ctaTitle: v || undefined })
              }
              placeholder='Título da chamada'
              readOnly={readOnly}
              className='font-bold text-[28px] text-white tracking-[-1px] sm:text-[32px] sm:tracking-[-1.2px]'
            />

            {content.ctaLabel || !readOnly ? (
              <GhostLink
                href={content.ctaHref}
                onHrefChange={(href) =>
                  onChange?.({ ...content, ctaHref: href || undefined })
                }
                readOnly={readOnly}
                data-cta
                className='inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-8 py-4 font-bold text-[#161c2d] text-[17px] tracking-[-0.6px] transition-opacity hover:opacity-90'
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
        </div>
      ) : null}

      <div className='bg-[#161c2d] px-6 pt-16 sm:px-10 lg:px-[123px]'>
        <div className='mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-12 pb-16 sm:grid-cols-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]'>
          <div className='col-span-2 flex flex-col gap-4 sm:col-span-4 lg:col-span-1'>
            <GhostInput
              value={content.logoText ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, logoText: v || undefined })
              }
              placeholder='Nome da marca'
              readOnly={readOnly}
              className={cn(
                b2bLogoFont.className,
                'font-bold text-[24px] text-white',
              )}
            />
            <GhostTextarea
              value={content.text ?? ''}
              onCommit={(v) => onChange?.({ ...content, text: v || undefined })}
              placeholder='Texto de apoio'
              readOnly={readOnly}
              as='p'
              className='max-w-[220px] text-[15px] text-white/65 leading-[1.7]'
            />
            <div className='flex items-center gap-4'>
              {content.socialLinks.map((social, index) => {
                const icon = SOCIAL_ICONS[social.platform.toLowerCase()]
                if (!icon) return null
                return (
                  <GhostLink
                    key={`${social.platform}-${index}`}
                    href={social.href}
                    onHrefChange={(href) => updateSocialLink(index, href)}
                    readOnly={readOnly}
                    className='opacity-80 hover:opacity-100'
                    aria-label={social.platform}
                  >
                    <img src={icon} alt='' className='h-4 w-4' />
                  </GhostLink>
                )
              })}
            </div>
          </div>

          {content.linkGroups.map((group, groupIndex) => (
            <div key={groupIndex} className='flex flex-col gap-4'>
              <GhostInput
                value={group.title}
                onCommit={(v) => updateGroupTitle(groupIndex, v)}
                placeholder='Título da coluna'
                readOnly={readOnly}
                className='text-[15px] text-white/65'
              />
              <ul className='flex flex-col gap-2'>
                {group.links.map((link, linkIndex) => (
                  <li
                    key={linkIndex}
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
                        className='text-[17px] text-white'
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
                        <SteelIcon
                          icon={Delete02Icon}
                          strokeWidth={2}
                          size={12}
                        />
                      </Button>
                    ) : null}
                  </li>
                ))}
                {!readOnly ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    aria-label='Adicionar link'
                    onClick={() => addLink(groupIndex)}
                  >
                    <SteelIcon icon={Add01Icon} strokeWidth={2} size={12} />
                  </Button>
                ) : null}
              </ul>
            </div>
          ))}
        </div>

        <div className='flex justify-center border-white/10 border-t py-6'>
          <GhostInput
            as='p'
            value={textOf(
              content,
              'copyright',
              `© ${new Date().getFullYear()} — Todos os direitos reservados.`,
            )}
            onCommit={(v) => onChange?.(withText(content, 'copyright', v))}
            readOnly={readOnly}
            className='text-center text-white/40 text-xs'
          />
        </div>
      </div>
    </footer>
  )
}
