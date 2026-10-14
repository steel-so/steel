'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { cn } from '@/lib/utils'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type FooterContent = Extract<CrmLandingPageSectionContent, { type: 'FOOTER' }>

const BASE = '/landing-page-templates/consultation'

const SOCIAL_ICONS: Record<string, string> = {
  twitter: `${BASE}/social-twitter.svg`,
  facebook: `${BASE}/social-facebook.svg`,
  instagram: `${BASE}/social-instagram.svg`,
  linkedin: `${BASE}/social-linkedin.svg`,
}

const HEART_ICON = `${BASE}/footer-heart.svg`

export function consultationFooterDefaultContent(): FooterContent {
  return {
    type: 'FOOTER',
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
          { label: '+133-394-3439-1435', href: 'tel:+13339343439' },
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

export function ConsultationFooter({
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
      className='border-[#161c2d]/10 border-t bg-white px-6 pt-16 sm:px-10 lg:px-[123px]'
    >
      <div className='mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-12 pb-16 sm:grid-cols-3 lg:grid-cols-5'>
        {content.linkGroups.map((group, groupIndex) => {
          const isContact = group.title === 'Contact us'
          return (
            <div key={groupIndex} className='flex flex-col gap-4'>
              <GhostInput
                value={group.title}
                onCommit={(v) => updateGroupTitle(groupIndex, v)}
                placeholder='Título da coluna'
                readOnly={readOnly}
                className='text-[#161c2d]/70 text-[15px] tracking-[-0.1px]'
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
                        className={cn(
                          'text-[17px] tracking-[-0.2px]',
                          isContact
                            ? 'font-bold text-[#473bf0]'
                            : 'text-[#161c2d]',
                        )}
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
          )
        })}
      </div>

      <div className='mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 border-[#161c2d]/10 border-t py-6 sm:flex-row'>
        <p className='flex items-center gap-1 text-[#161c2d] text-[15px] tracking-[-0.1px]'>
          <GhostInput
            value={textOf(
              content,
              'copyright',
              `© ${new Date().getFullYear()} Copyright, All Right Reserved, Made with`,
            )}
            onCommit={(v) => onChange?.(withText(content, 'copyright', v))}
            readOnly={readOnly}
            className='field-sizing-content w-auto text-inherit'
          />
          <img
            src={HEART_ICON}
            alt=''
            aria-hidden
            className='inline-block h-3 w-3'
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
                className='flex size-8 items-center justify-center rounded-md bg-[#f4f7fa] opacity-80 hover:opacity-100'
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
