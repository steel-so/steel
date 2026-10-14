'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type FooterContent = Extract<CrmLandingPageSectionContent, { type: 'FOOTER' }>

const BASE = '/landing-page-templates/ecommerce'
const CTA_BG = `${BASE}/cta-bg.png`

const SOCIAL_ICONS: Record<string, string> = {
  twitter: `${BASE}/social-twitter.svg`,
  facebook: `${BASE}/social-facebook.svg`,
  instagram: `${BASE}/social-instagram.svg`,
  linkedin: `${BASE}/social-linkedin.svg`,
}

// "Contact us" recebe o mesmo tratamento visual (link em negrito/azul) que o
// Figma dá a esse grupo especificamente — os demais grupos são links comuns.
const CONTACT_GROUP_TITLE = 'Contact us'

export function footerDefaultContent(): FooterContent {
  return {
    type: 'FOOTER',
    ctaTitle: 'Ready to have a decorated lifestyle?',
    ctaLabel: 'Start Shopping',
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
      {
        title: CONTACT_GROUP_TITLE,
        links: [
          {
            label: 'contato@suaempresa.com.br',
            href: 'mailto:contato@suaempresa.com.br',
          },
          { label: '+133-394-3439-1435', href: 'tel:+13339434391435' },
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

/**
 * Absorve o bloco "CTA" full-bleed do Figma (banner com foto de fundo, logo
 * antes do footer) como a faixa de topo deste componente — usa os campos
 * ctaTitle/ctaLabel/ctaHref que o schema de FOOTER já expõe pra exatamente
 * esse padrão. A imagem de fundo é fixa/decorativa (não editável pelo
 * schema), específica deste template.
 */
export function EcommerceFooter({
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
    <footer id='footer' className='bg-white'>
      {/* CTA — bloco "CTA" do Figma, absorvido aqui como faixa de topo */}
      <div className='px-6 sm:px-10 lg:px-[123px]'>
        <div
          className='relative isolate mx-auto flex max-w-6xl flex-col items-center justify-center gap-8 overflow-hidden rounded-[10px] px-6 py-24 text-center sm:py-28'
          style={{
            backgroundImage: `linear-gradient(rgba(22,28,45,0.55), rgba(22,28,45,0.55)), url(${CTA_BG})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <GhostInput
            as='h2'
            value={content.ctaTitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, ctaTitle: v || undefined })
            }
            placeholder='Título da chamada'
            readOnly={readOnly}
            className='max-w-2xl text-balance font-bold text-[38px] text-white leading-[1.1] tracking-[-1px] sm:text-[48px] lg:text-[60px] lg:leading-[65px]'
          />

          {content.ctaLabel || !readOnly ? (
            <GhostLink
              href={content.ctaHref}
              onHrefChange={(href) =>
                onChange?.({ ...content, ctaHref: href || undefined })
              }
              readOnly={readOnly}
              data-cta
              className='inline-flex shrink-0 items-center justify-center rounded-lg bg-[#68d585] px-8 py-4 font-bold text-[#161c2d] text-[17px] tracking-[-0.6px] transition-opacity hover:opacity-90'
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

      {/* Colunas de links */}
      <div className='mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-10 px-6 py-16 sm:grid-cols-3 sm:px-10 lg:grid-cols-5 lg:px-[123px]'>
        {content.linkGroups.map((group, groupIndex) => {
          const isContact = group.title === CONTACT_GROUP_TITLE
          return (
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
                        className={
                          isContact
                            ? 'font-bold text-[#473bf0] text-[17px]'
                            : 'text-[#161c2d] text-[17px]'
                        }
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

      {content.text || !readOnly ? (
        <div className='mx-auto max-w-6xl px-6 pb-6 sm:px-10 lg:px-[123px]'>
          <GhostTextarea
            value={content.text ?? ''}
            onCommit={(v) => onChange?.({ ...content, text: v || undefined })}
            placeholder='Texto de apoio'
            readOnly={readOnly}
            as='p'
            className='max-w-md text-[#161c2d]/60 text-[15px] leading-[1.7]'
          />
        </div>
      ) : null}

      <div className='mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 border-[#161c2d]/10 border-t px-6 py-6 sm:flex-row sm:px-10 lg:px-[123px]'>
        <GhostInput
          as='p'
          value={textOf(
            content,
            'copyright',
            `© ${new Date().getFullYear()} — Todos os direitos reservados.`,
          )}
          onCommit={(v) => onChange?.(withText(content, 'copyright', v))}
          placeholder='Texto de copyright'
          readOnly={readOnly}
          className='text-[#161c2d]/60 text-sm'
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
                className='opacity-70 hover:opacity-100'
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
