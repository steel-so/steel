import {
  Call02Icon,
  Facebook01Icon,
  FormIcon,
  Globe02Icon,
  InstagramIcon,
  Link01Icon,
  Mail01Icon,
  TiktokIcon,
  WhatsappIcon,
  YoutubeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { CrmPublicFormRenderer } from '@/app/_components/crm/crm-public-form-renderer'
import { SteelIcon } from '@/components/icon/icon'
import type { BioNetwork } from '@/src/lib/bio-link/destination'
import { youtubeVideoId } from '@/src/lib/bio-link/destination'
import type {
  BioBlockDTO,
  BioLinkBlockDTO,
  BioThemeDTO,
} from '@/src/schemas/bio-link.schema'
import type { CrmFormPublicDTO } from '@/types/crm-form'
import { BioVideo } from './bio-video'

const NETWORK_ICONS: Record<BioNetwork, typeof Link01Icon> = {
  custom: Link01Icon,
  whatsapp: WhatsappIcon,
  instagram: InstagramIcon,
  facebook: Facebook01Icon,
  site: Globe02Icon,
  youtube: YoutubeIcon,
  tiktok: TiktokIcon,
  email: Mail01Icon,
  phone: Call02Icon,
}

const RADIUS_PX = { none: 0, sm: 6, md: 12, lg: 18, full: 9999 } as const

const FONT_STACKS = {
  sans: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
  serif: "Georgia, Cambria, 'Times New Roman', serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  rounded:
    "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Quicksand, system-ui, sans-serif",
} as const

/** Page background for a theme (solid or a soft diagonal gradient). */
export function bioBackground(theme: BioThemeDTO): string {
  return theme.background === 'gradient'
    ? `linear-gradient(160deg, ${theme.backgroundColor}, ${theme.backgroundColor2})`
    : theme.backgroundColor
}

function buttonStyle(theme: BioThemeDTO): React.CSSProperties {
  const radius = RADIUS_PX[theme.radius]
  const base: React.CSSProperties = {
    borderRadius: radius,
    borderWidth: 2,
    borderStyle: 'solid',
  }
  if (theme.buttonStyle === 'outline') {
    return {
      ...base,
      borderColor: theme.buttonColor,
      color: theme.buttonColor,
      background: 'transparent',
    }
  }
  if (theme.buttonStyle === 'soft') {
    return {
      ...base,
      borderColor: 'transparent',
      color: theme.textColor,
      background: `color-mix(in srgb, ${theme.buttonColor} 16%, transparent)`,
    }
  }
  return {
    ...base,
    borderColor: theme.buttonColor,
    color: theme.buttonTextColor,
    background: theme.buttonColor,
  }
}

const BUTTON_CLASS =
  'flex min-h-12 w-full items-center justify-center gap-2.5 px-5 py-3 text-center font-medium text-[15px] leading-snug transition-transform duration-150 hover:scale-[1.015] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:scale-100'

function ButtonLabel({ block }: { block: BioLinkBlockDTO }): ReactNode {
  return (
    <>
      <SteelIcon
        icon={NETWORK_ICONS[block.network]}
        size={20}
        strokeWidth={1.75}
        className='shrink-0'
      />
      <span className='min-w-0 break-words'>{block.title}</span>
    </>
  )
}

/**
 * The visible content of a bio page: avatar, name, description and the
 * blocks in order. Shared by the public page (`/b/<slug>`, real links through
 * the tracked redirect) and the editor's phone preview (`linkHref` omitted:
 * buttons are inert). Pure markup; only the YouTube player and an embedded
 * CRM form are client components.
 */
export function BioLinkView({
  title,
  description,
  avatarUrl,
  theme,
  blocks,
  linkHref,
  forms = {},
  className,
}: {
  title: string
  description: string | null
  avatarUrl: string | null
  theme: BioThemeDTO
  /** Blocks already filtered for visibility. */
  blocks: BioBlockDTO[]
  /** Address of a button; without it the buttons are not links (preview). */
  linkHref?: (block: BioBlockDTO) => string
  /** Public CRM forms by token, for embedded form blocks. */
  forms?: Record<string, CrmFormPublicDTO>
  className?: string
}) {
  const radius = RADIUS_PX[theme.radius]
  const buttonProps = (block: BioBlockDTO) => {
    const href = linkHref?.(block)
    return href
      ? { href, rel: 'noopener noreferrer nofollow', target: '_blank' }
      : { 'aria-disabled': true as const }
  }

  return (
    <div
      className={className}
      style={{
        background: bioBackground(theme),
        color: theme.textColor,
        fontFamily: FONT_STACKS[theme.font],
      }}
    >
      <main className='mx-auto flex w-full max-w-md flex-col items-center gap-3 px-5 pt-12 pb-10'>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=''
            width={96}
            height={96}
            className='size-24 rounded-full object-cover'
            style={{ boxShadow: `0 0 0 3px ${theme.buttonColor}` }}
          />
        ) : null}
        <h1 className='text-balance text-center font-semibold text-xl'>
          {title}
        </h1>
        {description ? (
          <p className='mb-2 max-w-xs text-pretty text-center text-sm opacity-80'>
            {description}
          </p>
        ) : null}

        <div className='flex w-full flex-col gap-3'>
          {blocks.map((block) => {
            if (block.type === 'header') {
              return (
                <h2
                  key={block.id}
                  className='mt-3 text-center font-semibold text-sm uppercase tracking-wide opacity-70'
                >
                  {block.title}
                </h2>
              )
            }
            if (block.type === 'video') {
              const id = youtubeVideoId(block.url)
              if (!id) return null
              return (
                <BioVideo
                  key={block.id}
                  videoId={id}
                  title={block.title?.trim() || 'Vídeo'}
                  radius={radius}
                  color={theme.buttonTextColor}
                  background={theme.buttonColor}
                />
              )
            }
            if (block.type === 'form' && block.mode === 'embed') {
              const form = forms[block.formToken]
              return (
                <section
                  key={block.id}
                  aria-label={block.title}
                  className='overflow-hidden border bg-background p-4 text-foreground'
                  style={{ borderRadius: radius }}
                >
                  {form ? (
                    <CrmPublicFormRenderer
                      form={form}
                      publicToken={linkHref ? block.formToken : undefined}
                      preview={!linkHref}
                    />
                  ) : (
                    <p className='flex items-center gap-2 text-sm'>
                      <SteelIcon icon={FormIcon} size={18} />
                      {block.title}
                    </p>
                  )}
                </section>
              )
            }
            if (block.type === 'form') {
              return (
                <a
                  key={block.id}
                  className={BUTTON_CLASS}
                  style={buttonStyle(theme)}
                  {...buttonProps(block)}
                >
                  <SteelIcon
                    icon={FormIcon}
                    size={20}
                    strokeWidth={1.75}
                    className='shrink-0'
                  />
                  <span className='min-w-0 break-words'>{block.title}</span>
                </a>
              )
            }
            return (
              <a
                key={block.id}
                className={BUTTON_CLASS}
                style={buttonStyle(theme)}
                {...buttonProps(block)}
              >
                <ButtonLabel block={block} />
              </a>
            )
          })}
        </div>
      </main>
    </div>
  )
}
