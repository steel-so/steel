'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostVideo } from '@/components/ui/ghost-video'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  uploadCrmLandingPageImage,
  uploadCrmLandingPageVideo,
} from '@/src/hooks/use-crm-landing-page'
import { coworkingLogoFont } from '@/src/lib/landing-page-templates/coworking/fonts'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type HeroContent = Extract<CrmLandingPageSectionContent, { type: 'HERO' }>
type DropdownField = { label: string; options: string[] }

const BASE = '/landing-page-templates/coworking'
const DEFAULT_BG = `${BASE}/hero-bg.jpg`
const PIN_ICON = `${BASE}/pin-icon.svg`
const CALENDAR_ICON = `${BASE}/calendar-icon.svg`
const DROPDOWN_ICON = `${BASE}/dropdown-icon.svg`
const VIDEO_ICON = `${BASE}/video-play-icon.svg`
const CHEVRON_DOWN_ICON = `${BASE}/chevron-down-icon.svg`

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    eyebrow: 'Shared space in your town',
    title: 'Rent desk space in a shared office environment',
    ctaLabel: 'Search Place',
    ctaHref: '#locations',
    imageUrl: DEFAULT_BG,
    navLinks: [
      { label: 'Demos', href: '#' },
      { label: 'Pages', href: '#' },
      { label: 'Support', href: '#' },
      { label: 'Contact', href: '#footer' },
    ],
    dropdowns: [
      {
        label: 'Select Location',
        options: ['Downtown', 'Uptown', 'Midtown', 'Riverside'],
      },
      {
        label: 'Select Date',
        options: ['This week', 'This month', 'Next month', 'Flexible'],
      },
    ],
  }
}

export function CoworkingHero({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<HeroContent>) {
  const navLinks = content.navLinks ?? []
  const dropdowns = content.dropdowns ?? []

  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, imageUrl: res.data.url })
  }

  async function handleVideo(file: File) {
    const res = await uploadCrmLandingPageVideo(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar o vídeo.')
      return
    }
    onChange?.({ ...content, videoUrl: res.data.url })
  }

  function addLink() {
    onChange?.({
      ...content,
      navLinks: [...navLinks, { label: 'Link', href: '#' }],
    })
  }

  function updateLink(
    index: number,
    patch: Partial<{ label: string; href: string }>,
  ) {
    onChange?.({
      ...content,
      navLinks: navLinks.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    })
  }

  function removeLink(index: number) {
    onChange?.({
      ...content,
      navLinks: navLinks.filter((_, i) => i !== index),
    })
  }

  function updateDropdown(index: number, patch: Partial<DropdownField>) {
    onChange?.({
      ...content,
      dropdowns: dropdowns.map((d, i) =>
        i === index ? { ...d, ...patch } : d,
      ),
    })
  }

  return (
    <section className='relative overflow-hidden bg-[#161c2d]'>
      <div className='absolute inset-0'>
        {content.videoUrl ? (
          <GhostVideo
            value={content.videoUrl}
            onUpload={handleVideo}
            readOnly={readOnly}
            className='size-full object-cover'
          />
        ) : (
          <GhostImage
            value={content.imageUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt=''
            className='size-full object-cover'
          />
        )}
        <div className='absolute inset-0 bg-[#161c2d]/60' aria-hidden />
      </div>

      {!readOnly ? (
        <div className='absolute top-4 right-4 z-10 flex w-32 flex-col gap-1.5 rounded-md bg-black/40 p-1.5 backdrop-blur-sm'>
          <span className='px-0.5 text-[10px] text-white/70'>
            Vídeo de fundo (opcional)
          </span>
          <GhostVideo
            value={content.videoUrl}
            onUpload={handleVideo}
            className='h-16 w-full overflow-hidden rounded'
          />
          {content.videoUrl ? (
            <button
              type='button'
              onClick={() => onChange?.({ ...content, videoUrl: undefined })}
              className='px-0.5 text-left text-[10px] text-white/70 hover:text-white'
            >
              Remover vídeo
            </button>
          ) : null}
        </div>
      ) : null}

      <div className='relative mx-auto flex max-w-[1600px] flex-col items-center px-6 py-10 sm:px-10 lg:px-[123px] lg:py-16'>
        <div className='flex w-full items-center justify-between'>
          <GhostInput
            value={textOf(content, 'logo', 'Brainwave.io')}
            onCommit={(v) => onChange?.(withText(content, 'logo', v))}
            placeholder='Nome da marca'
            readOnly={readOnly}
            className={cn(
              coworkingLogoFont.className,
              'font-bold text-[24px] text-white',
            )}
          />
          <nav className='hidden items-center gap-8 font-bold text-[15px] text-white tracking-[-0.1px] sm:flex'>
            {navLinks.map((link, index) => (
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
        </div>

        <div className='flex flex-col items-center gap-6 py-24 text-center sm:py-32 lg:py-40'>
          {content.eyebrow || !readOnly ? (
            <GhostInput
              value={content.eyebrow ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, eyebrow: v || undefined })
              }
              placeholder='Texto de destaque'
              readOnly={readOnly}
              className='text-center font-bold text-[#68d585] text-[13px] uppercase tracking-[1.6px]'
            />
          ) : null}

          <GhostInput
            as='h1'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título principal'
            readOnly={readOnly}
            className='max-w-3xl text-balance text-center font-bold text-[38px] text-white leading-[1.1] tracking-[-1px] sm:text-[48px] lg:text-[60px] lg:leading-[65px] lg:tracking-[-2px]'
          />

          <div className='mt-4 flex w-full max-w-3xl flex-col items-stretch gap-3 rounded-[10px] bg-white p-3 shadow-[0px_54px_53px_-23px_rgba(22,28,45,0.5)] sm:flex-row sm:items-center'>
            {dropdowns[0] ? (
              <DropdownField
                dropdown={dropdowns[0]}
                icon={PIN_ICON}
                iconClassName='h-[17px] w-[13px]'
                onChange={(patch) => updateDropdown(0, patch)}
                readOnly={readOnly}
              />
            ) : null}
            <div className='hidden w-px self-stretch bg-[#e7e9ed] sm:block' />
            {dropdowns[1] ? (
              <DropdownField
                dropdown={dropdowns[1]}
                icon={CALENDAR_ICON}
                iconClassName='h-[18px] w-[18px]'
                onChange={(patch) => updateDropdown(1, patch)}
                readOnly={readOnly}
              />
            ) : null}

            {content.ctaLabel || !readOnly ? (
              <GhostLink
                href={content.ctaHref}
                onHrefChange={(href) =>
                  onChange?.({ ...content, ctaHref: href || undefined })
                }
                readOnly={readOnly}
                data-cta
                className='inline-flex shrink-0 items-center justify-center rounded-[8px] bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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

          <GhostLink
            href={hrefOf(content, 'tour', '#facts')}
            onHrefChange={(v) => onChange?.(withHref(content, 'tour', v))}
            readOnly={readOnly}
            className='mt-6 inline-flex items-center gap-2 font-bold text-[17px] text-white tracking-[-0.2px] hover:opacity-80'
          >
            <img
              src={VIDEO_ICON}
              alt=''
              aria-hidden
              className='h-[19px] w-[19px]'
            />
            <GhostInput
              value={textOf(content, 'tour', 'Take virtual tour of our spaces')}
              onCommit={(v) => onChange?.(withText(content, 'tour', v))}
              placeholder='Texto do link'
              readOnly={readOnly}
              className='field-sizing-content text-inherit'
            />
          </GhostLink>
        </div>

        <GhostLink
          href={hrefOf(content, 'scrollDown', '#facts')}
          onHrefChange={(v) => onChange?.(withHref(content, 'scrollDown', v))}
          readOnly={readOnly}
          aria-label='Rolar para baixo'
          className='mb-4 flex size-10 items-center justify-center rounded-full border border-white/40 hover:bg-white/10'
        >
          <img src={CHEVRON_DOWN_ICON} alt='' className='h-[6px] w-[12px]' />
        </GhostLink>
      </div>
    </section>
  )
}

/**
 * Dropdown decorativo do formulário de busca (sem backend real, igual hoje)
 * — em modo de edição, o "pill" vira um botão que abre um popover com
 * rótulo + opções editáveis (mesmo padrão de `setOption`/`addOption`/
 * `removeOption` do form builder do CRM). Em `readOnly`, só o rótulo estático.
 */
function DropdownField({
  dropdown,
  icon,
  iconClassName,
  onChange,
  readOnly,
}: {
  dropdown: DropdownField
  icon: string
  iconClassName: string
  onChange: (patch: Partial<DropdownField>) => void
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)

  function setOption(index: number, value: string) {
    onChange({
      options: dropdown.options.map((o, i) => (i === index ? value : o)),
    })
  }

  function addOption() {
    onChange({ options: [...dropdown.options, 'Opção'] })
  }

  function removeOption(index: number) {
    onChange({ options: dropdown.options.filter((_, i) => i !== index) })
  }

  if (readOnly) {
    return (
      <div className='flex flex-1 items-center gap-3 px-3 py-2'>
        <img
          src={icon}
          alt=''
          aria-hidden
          className={cn('shrink-0', iconClassName)}
        />
        <span className='text-[#161c2d] text-[15px] tracking-[-0.1px]'>
          {dropdown.label}
        </span>
        <img
          src={DROPDOWN_ICON}
          alt=''
          aria-hidden
          className='ml-auto h-[5px] w-[10px] shrink-0 opacity-60'
        />
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type='button'
            className='flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/50'
          >
            <img
              src={icon}
              alt=''
              aria-hidden
              className={cn('shrink-0', iconClassName)}
            />
            <span className='text-[#161c2d] text-[15px] tracking-[-0.1px]'>
              {dropdown.label || 'Dropdown'}
            </span>
            <img
              src={DROPDOWN_ICON}
              alt=''
              aria-hidden
              className='ml-auto h-[5px] w-[10px] shrink-0 opacity-60'
            />
          </button>
        }
      />
      <PopoverContent className='w-72'>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label>Rótulo do campo</Label>
            <Input
              value={dropdown.label}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder='Rótulo do campo'
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label>Opções</Label>
            {dropdown.options.map((opt, index) => (
              <div key={index} className='flex items-center gap-2'>
                <Input
                  value={opt}
                  onChange={(e) => setOption(index, e.target.value)}
                  placeholder='Opção'
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label='Remover opção'
                  onClick={() => removeOption(index)}
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </div>
            ))}
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={addOption}
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Adicionar opção
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
