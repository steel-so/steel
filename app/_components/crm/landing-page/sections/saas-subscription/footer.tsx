'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { cn } from '@/lib/utils'
import { saasSubscriptionLogoFont } from '@/src/lib/landing-page-templates/saas-subscription/fonts'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type FooterContent = Extract<CrmLandingPageSectionContent, { type: 'FOOTER' }>

const BASE = '/landing-page-templates/saas-subscription'

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
    ctaTitle: 'Build better landing page fast',
    ctaDescription:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    ctaLabel: 'Get it now',
    ctaHref: '#footer',
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

export function SaasSubscriptionFooter({
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
    <footer id='footer' className='bg-white px-6 pt-16 sm:px-10 lg:px-[123px]'>
      {/* CTA (bloco "CTA" do Figma, dobrado aqui como no padrão do Footer) */}
      <div className='mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 pb-10 sm:flex-row sm:items-center'>
        <div className='flex max-w-lg flex-col gap-3'>
          <GhostInput
            as='h2'
            value={content.ctaTitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, ctaTitle: v || undefined })
            }
            placeholder='Título da chamada'
            readOnly={readOnly}
            className='font-bold text-[#161c2d] text-[32px] leading-[1.2] tracking-[-1.2px]'
          />
          <GhostTextarea
            value={content.ctaDescription ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, ctaDescription: v || undefined })
            }
            placeholder='Texto de apoio'
            readOnly={readOnly}
            as='p'
            className='text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
        </div>

        <div className='flex shrink-0 items-center gap-4'>
          <GhostLink
            href={hrefOf(content, 'cta.secondary', '#')}
            onHrefChange={(v) =>
              onChange?.(withHref(content, 'cta.secondary', v))
            }
            readOnly={readOnly}
            className='inline-flex items-center justify-center rounded-lg bg-[#473bf0]/8 px-6 py-4 font-bold text-[#473bf0] text-[17px] tracking-[-0.6px] hover:opacity-90'
          >
            <GhostInput
              value={textOf(content, 'cta.secondary', 'Learn more')}
              onCommit={(v) =>
                onChange?.(withText(content, 'cta.secondary', v))
              }
              placeholder='Texto do botão'
              readOnly={readOnly}
              className='text-inherit'
            />
          </GhostLink>
          {content.ctaLabel || !readOnly ? (
            <GhostLink
              href={content.ctaHref}
              onHrefChange={(href) =>
                onChange?.({ ...content, ctaHref: href || undefined })
              }
              readOnly={readOnly}
              data-cta
              className='inline-flex items-center justify-center rounded-lg bg-[#473bf0] px-6 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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

      <div className='mx-auto max-w-6xl border-[#161c2d]/10 border-t' />

      {/* Colunas */}
      <div className='mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-12 py-16 sm:grid-cols-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]'>
        <div className='col-span-2 flex flex-col gap-4 sm:col-span-4 lg:col-span-1'>
          <GhostInput
            value={content.logoText ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, logoText: v || undefined })
            }
            placeholder='Nome da marca'
            readOnly={readOnly}
            className={cn(
              saasSubscriptionLogoFont.className,
              'font-bold text-[#161c2d] text-[28px]',
            )}
          />
          <GhostTextarea
            value={content.text ?? ''}
            onCommit={(v) => onChange?.({ ...content, text: v || undefined })}
            placeholder='Texto de apoio'
            readOnly={readOnly}
            as='p'
            className='max-w-[220px] text-[#161c2d]/70 text-[15px] leading-[1.7]'
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
              className='text-[#161c2d]/70 text-[15px]'
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
                      className='text-[#161c2d] text-[17px]'
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

      <p className='border-[#161c2d]/10 border-t py-6 text-center text-[#161c2d]/40 text-xs'>
        © {new Date().getFullYear()} —{' '}
        <GhostInput
          value={textOf(content, 'copyright', 'Todos os direitos reservados.')}
          onCommit={(v) => onChange?.(withText(content, 'copyright', v))}
          placeholder='Texto de copyright'
          readOnly={readOnly}
          className='field-sizing-content w-auto text-inherit'
        />
      </p>
    </footer>
  )
}
