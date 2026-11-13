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

const BASE = '/landing-page-templates/coworking'

const SOCIAL_ICONS: Record<string, string> = {
  twitter: `${BASE}/social-twitter.svg`,
  facebook: `${BASE}/social-facebook.svg`,
  instagram: `${BASE}/social-instagram.svg`,
  linkedin: `${BASE}/social-linkedin.svg`,
}

/** Fiel ao rodapé "Footer/Light/Style 02" do Figma — 5 colunas de links
 * (a última, "Contact us", carrega e-mail/telefone reaproveitando o mesmo
 * LinkSchema) + barra inferior com copyright e ícones sociais. Não tem o
 * banner de CTA nem a coluna de marca que o Agency usa — o schema suporta
 * ambos, mas este template simplesmente não os popula. */
export function footerDefaultContent(): FooterContent {
  return {
    type: 'FOOTER',
    linkGroups: [
      {
        title: 'Empresa',
        links: [
          { label: 'Sobre nós', href: '#' },
          { label: 'Fale conosco', href: '#' },
          { label: 'Carreiras', href: '#' },
          { label: 'Imprensa', href: '#' },
        ],
      },
      {
        title: 'Produto',
        links: [
          { label: 'Recursos', href: '#' },
          { label: 'Preços', href: '#' },
          { label: 'Novidades', href: '#' },
          { label: 'Central de ajuda', href: '#' },
          { label: 'Suporte', href: '#' },
        ],
      },
      {
        title: 'Serviços',
        links: [
          { label: 'Marketing Digital', href: '#' },
          { label: 'Produção de Conteúdo', href: '#' },
          { label: 'SEO para Empresas', href: '#' },
          { label: 'Design de Interface', href: '#' },
        ],
      },
      {
        title: 'Legal',
        links: [
          { label: 'Política de Privacidade', href: '#' },
          { label: 'Termos e Condições', href: '#' },
          { label: 'Política de Devolução', href: '#' },
        ],
      },
      {
        title: 'Fale conosco',
        links: [
          {
            label: 'contato@suaempresa.com.br',
            href: 'mailto:contato@suaempresa.com.br',
          },
          { label: '+133-394-3439-1435', href: 'tel:+13339433439-1435' },
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

export function CoworkingFooter({
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
      <div className='mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-10 pb-16 sm:grid-cols-3 lg:grid-cols-5'>
        {content.linkGroups.map((group, groupIndex) => {
          const isContact = /contact|fale conosco/i.test(group.title)
          return (
            <div key={groupIndex} className='flex flex-col gap-4'>
              <GhostInput
                value={group.title}
                onCommit={(v) => updateGroupTitle(groupIndex, v)}
                placeholder='Título da coluna'
                readOnly={readOnly}
                className='text-[#161c2d]/70 text-[15px]'
              />
              <ul className='flex flex-col gap-1'>
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

      <div className='mx-auto max-w-6xl border-[#161c2d]/10 border-t' />

      <div className='mx-auto flex max-w-6xl flex-col-reverse items-center justify-between gap-4 py-6 sm:flex-row'>
        <GhostInput
          as='p'
          value={textOf(
            content,
            'copyright',
            `© ${new Date().getFullYear()} Todos os direitos reservados.`,
          )}
          onCommit={(v) => onChange?.(withText(content, 'copyright', v))}
          placeholder='Texto de copyright'
          readOnly={readOnly}
          className='text-[#161c2d] text-[15px]'
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
    </footer>
  )
}
