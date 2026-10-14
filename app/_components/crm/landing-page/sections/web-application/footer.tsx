'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type FooterContent = Extract<CrmLandingPageSectionContent, { type: 'FOOTER' }>

const BASE = '/landing-page-templates/web-application'

const SOCIAL_ICONS: Record<string, string> = {
  twitter: `${BASE}/social-twitter.svg`,
  facebook: `${BASE}/social-facebook.svg`,
  instagram: `${BASE}/social-instagram.svg`,
  linkedin: `${BASE}/social-linkedin.svg`,
}

/**
 * O rodapé do Figma não tem logo nem faixa de CTA (diferente do Agency) —
 * só 5 colunas de links (a 5ª, "Contact us", vira um `linkGroup` com
 * e-mail/telefone como `mailto:`/`tel:`, já que o schema não tem campo de
 * texto simples pra isso) + selo de copyright e ícones sociais.
 */
export function footerDefaultContent(): FooterContent {
  return {
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
      {
        title: 'Contact us',
        links: [
          {
            label: 'contato@suaempresa.com.br',
            href: 'mailto:contato@suaempresa.com.br',
          },
          { label: '+133-394-3439-1435', href: 'tel:+13393943439' },
        ],
      },
    ],
    socialLinks: [
      { platform: 'twitter', href: '#' },
      { platform: 'facebook', href: '#' },
      { platform: 'instagram', href: '#' },
      { platform: 'linkedin', href: '#' },
    ],
    type: 'FOOTER',
  }
}

export function WebApplicationFooter({
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
    <footer
      id='footer'
      className='bg-[#161c2d] px-6 pt-16 sm:px-10 lg:px-[123px]'
    >
      {content.ctaTitle || content.ctaLabel || !readOnly ? (
        <>
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
                className='font-bold text-[32px] text-white leading-[1.2] tracking-[-1.2px]'
              />
              <GhostInput
                value={content.ctaDescription ?? ''}
                onCommit={(v) =>
                  onChange?.({ ...content, ctaDescription: v || undefined })
                }
                placeholder='Texto de apoio'
                readOnly={readOnly}
                className='text-[19px] text-white/65'
              />
            </div>
            {content.ctaLabel || !readOnly ? (
              <GhostLink
                href={content.ctaHref}
                onHrefChange={(href) =>
                  onChange?.({ ...content, ctaHref: href || undefined })
                }
                readOnly={readOnly}
                data-cta
                className='inline-flex shrink-0 items-center justify-center rounded-lg bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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
          <div className='mx-auto max-w-6xl border-white/10 border-t' />
        </>
      ) : null}

      <div className='mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-12 py-16 sm:grid-cols-5'>
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

      <div className='mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 border-white/10 border-t py-6 sm:flex-row'>
        <p className='text-white/40 text-xs'>
          © {new Date().getFullYear()}{' '}
          <GhostInput
            value={textOf(
              content,
              'copyright',
              'Copyright, All Right Reserved.',
            )}
            onCommit={(v) => onChange?.(withText(content, 'copyright', v))}
            placeholder='Texto de copyright'
            readOnly={readOnly}
            className='field-sizing-content w-auto text-inherit'
          />
        </p>
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
                className='flex size-8 items-center justify-center rounded-full bg-white/10 opacity-80 hover:opacity-100'
                aria-label={social.platform}
              >
                <img src={icon} alt='' className='h-4 w-4' />
              </GhostLink>
            )
          })}
        </div>
      </div>
    </footer>
  )
}
