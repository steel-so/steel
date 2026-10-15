import type { CSSProperties } from 'react'
import { Img, Link, Text } from 'react-email'
import { defineComponent } from '@/src/lib/canvas/registry'
import { spacing } from '@/src/lib/canvas/values'
import {
  alignField,
  BLOCK_LAYOUT_SECTION,
  colorField,
  EMAIL_LINK_TARGETS,
  linkField,
  typographyField,
} from '../inspector'
import { mobileClass } from '../mobile'
import {
  BlockFrame,
  EditorHint,
  emailHref,
  pick,
  SHOWN,
  typographyStyle,
} from '../primitives'
import {
  type EmailLogoProps,
  type EmailMenuProps,
  type EmailSignatureProps,
  type EmailSocialProps,
  logoSchema,
  menuSchema,
  SOCIAL_NETWORKS,
  signatureSchema,
  socialSchema,
} from '../schemas'
import { EMAIL_PALETTE, type EmailViewProps, emailColor } from '../theme'
import { emailBody, emailView } from './layout'

// ─── logo ─────────────────────────────────────────────────────────────────

function LogoView(props: EmailViewProps<EmailLogoProps>) {
  const { node } = props
  const { brand } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const src = p.image.src.trim() || brand.logoUrl
  const alt = p.image.alt.trim() || brand.companyName
  const href = emailHref(p.link)
  const content = src ? (
    <Img
      src={src}
      alt={alt}
      height={p.height}
      style={{
        display: 'inline-block',
        height: p.height,
        width: 'auto',
        maxWidth: '100%',
        border: 0,
      }}
    />
  ) : (
    <Text
      style={{
        margin: 0,
        fontSize: 20,
        lineHeight: '28px',
        fontWeight: 700,
        fontFamily: body.fontStack,
        color: brand.primaryColor,
      }}
    >
      {brand.companyName}
    </Text>
  )
  return (
    <BlockFrame {...props} align={p.align}>
      {href ? (
        <Link href={href} style={{ textDecoration: 'none' }}>
          {content}
        </Link>
      ) : (
        content
      )}
    </BlockFrame>
  )
}

export const logoDefinition = defineComponent<EmailLogoProps>({
  type: 'email.logo',
  label: 'Logo',
  icon: 'logo',
  category: 'Marca',
  keywords: ['marca', 'cabeçalho', 'empresa'],
  propsSchema: logoSchema,
  defaultProps: () => ({
    image: { src: '', alt: '' },
    height: 36,
    align: 'left',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Logo',
      tab: 'content',
      fields: [
        {
          path: 'image',
          label: 'Imagem',
          control: { kind: 'image' },
          help: 'Vazio usa o logo da marca do workspace.',
        },
        linkField('link', 'Link ao clicar'),
        alignField(),
        {
          path: 'height',
          label: 'Altura',
          control: { kind: 'number', min: 16, max: 160, unit: 'px' },
        },
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(LogoView),
})

// ─── social ───────────────────────────────────────────────────────────────

export const SOCIAL_LABELS: Record<(typeof SOCIAL_NETWORKS)[number], string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  website: 'Site',
}

/**
 * Social links render as text pills, not icon images: icon files would
 * depend on an external host and are blocked by default in many clients,
 * while text pills always show and stay readable in dark mode.
 */
function SocialView(props: EmailViewProps<EmailSocialProps>) {
  const { node } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const color = emailColor(p.color, tokens) ?? EMAIL_PALETTE.fg
  const pill: CSSProperties = {
    display: 'inline-block',
    margin: '0 4px 8px',
    padding: p.variant === 'text' ? '4px 2px' : '6px 14px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: '18px',
    fontFamily: body.fontStack,
    textDecoration: p.variant === 'text' ? 'underline' : 'none',
    ...(p.variant === 'solid'
      ? { backgroundColor: color, color: '#FFFFFF' }
      : p.variant === 'outline'
        ? { border: `1px solid ${color}`, color }
        : { color }),
  }
  return (
    <BlockFrame {...props} align={p.align}>
      {p.items.map((item, index) => (
        <Link key={index} href={emailHref(item.link)} style={pill}>
          {SOCIAL_LABELS[item.network]}
        </Link>
      ))}
    </BlockFrame>
  )
}

export const socialDefinition = defineComponent<EmailSocialProps>({
  type: 'email.social',
  label: 'Redes sociais',
  icon: 'social',
  category: 'Marca',
  keywords: ['instagram', 'linkedin', 'facebook', 'whatsapp', 'seguir'],
  propsSchema: socialSchema,
  defaultProps: () => ({
    items: [
      {
        network: 'instagram',
        link: { type: 'url', value: 'https://instagram.com/' },
      },
      {
        network: 'linkedin',
        link: { type: 'url', value: 'https://linkedin.com/' },
      },
    ],
    align: 'center',
    variant: 'outline',
    color: 'token:primary',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Redes',
      tab: 'content',
      fields: [
        {
          path: 'items',
          label: 'Perfis',
          control: {
            kind: 'list',
            itemLabel: 'Perfil',
            max: 10,
            fields: [
              {
                path: 'network',
                label: 'Rede',
                control: {
                  kind: 'select',
                  options: SOCIAL_NETWORKS.map((value) => ({
                    value,
                    label: SOCIAL_LABELS[value],
                  })),
                },
              },
              {
                path: 'link',
                label: 'Endereço',
                control: { kind: 'link', targets: EMAIL_LINK_TARGETS },
              },
            ],
          },
        },
        alignField(),
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        {
          path: 'variant',
          label: 'Estilo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'solid', label: 'Preenchido' },
              { value: 'outline', label: 'Contorno' },
              { value: 'text', label: 'Texto' },
            ],
          },
        },
        colorField('color', 'Cor'),
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(SocialView),
})

// ─── menu ─────────────────────────────────────────────────────────────────

function MenuView(props: EmailViewProps<EmailMenuProps>) {
  const { node, breakpoint, editing } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const color = emailColor(p.color, tokens) ?? EMAIL_PALETTE.fg2
  return (
    <BlockFrame {...props} align={p.align}>
      <Text
        className={editing ? undefined : mobileClass(node, 'text')}
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: '22px',
          fontFamily: body.fontStack,
          color,
          ...typographyStyle(p.typography, breakpoint, editing),
        }}
      >
        {p.items.map((item, index) => (
          <span key={index}>
            {index > 0 && p.separator ? (
              <span style={{ padding: '0 8px', color: EMAIL_PALETTE.fg3 }}>
                {p.separator}
              </span>
            ) : index > 0 ? (
              ' '
            ) : null}
            <Link
              href={emailHref(item.link)}
              style={{ color, textDecoration: 'none', fontWeight: 600 }}
            >
              {item.label}
            </Link>
          </span>
        ))}
      </Text>
    </BlockFrame>
  )
}

export const menuDefinition = defineComponent<EmailMenuProps>({
  type: 'email.menu',
  label: 'Menu',
  icon: 'menu',
  category: 'Marca',
  keywords: ['navegação', 'links', 'cabeçalho'],
  propsSchema: menuSchema,
  defaultProps: () => ({
    items: [
      { label: 'Produtos', link: { type: 'url', value: 'https://' } },
      { label: 'Blog', link: { type: 'url', value: 'https://' } },
      { label: 'Contato', link: { type: 'url', value: 'https://' } },
    ],
    separator: '|',
    align: 'center',
    color: 'token:text-muted',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Menu',
      tab: 'content',
      fields: [
        {
          path: 'items',
          label: 'Links',
          control: {
            kind: 'list',
            itemLabel: 'Link',
            max: 8,
            fields: [
              {
                path: 'label',
                label: 'Texto',
                control: { kind: 'text', maxLength: 60 },
              },
              {
                path: 'link',
                label: 'Endereço',
                control: { kind: 'link', targets: EMAIL_LINK_TARGETS },
              },
            ],
          },
        },
        {
          path: 'separator',
          label: 'Separador',
          control: { kind: 'text', maxLength: 3 },
        },
        alignField(),
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [colorField('color', 'Cor'), typographyField()],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(MenuView),
})

// ─── signature ────────────────────────────────────────────────────────────

function SignatureView(props: EmailViewProps<EmailSignatureProps>) {
  const { node, breakpoint, editing } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const color = emailColor(p.color, tokens) ?? body.textColor
  const line: CSSProperties = {
    margin: 0,
    fontSize: 15,
    lineHeight: '22px',
    fontFamily: body.fontStack,
    color,
  }
  const photo = p.photo.src.trim()
  const align = pick(p.align, breakpoint, editing)
  const lines = (
    <>
      {p.closing ? (
        <Text style={{ ...line, margin: '0 0 8px' }}>{p.closing}</Text>
      ) : null}
      {p.name ? (
        <Text style={{ ...line, fontWeight: 600, color: EMAIL_PALETTE.fg }}>
          {p.name}
        </Text>
      ) : null}
      {p.role ? <Text style={line}>{p.role}</Text> : null}
      {p.contact ? <Text style={line}>{p.contact}</Text> : null}
      {!p.closing && !p.name && !p.role && !p.contact ? (
        <EditorHint editing={editing} label='Preencha a assinatura' />
      ) : null}
    </>
  )
  return (
    <BlockFrame {...props} align={p.align}>
      {photo ? (
        <table
          role='presentation'
          cellPadding={0}
          cellSpacing={0}
          border={0}
          align={align}
        >
          <tbody>
            <tr>
              <td width={72} valign='top' style={{ paddingRight: 16 }}>
                <Img
                  src={photo}
                  alt={p.photo.alt || p.name}
                  width={56}
                  height={56}
                  style={{ borderRadius: 28, display: 'block' }}
                />
              </td>
              <td valign='top' style={{ textAlign: 'left' }}>
                {lines}
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        lines
      )}
    </BlockFrame>
  )
}

export const signatureDefinition = defineComponent<EmailSignatureProps>({
  type: 'email.signature',
  label: 'Assinatura',
  icon: 'signature',
  category: 'Marca',
  keywords: ['remetente', 'vendedor', 'contato', 'atenciosamente'],
  propsSchema: signatureSchema,
  defaultProps: () => ({
    closing: 'Um abraço,',
    name: 'Seu nome',
    role: 'Cargo · Empresa',
    contact: '',
    photo: { src: '', alt: '' },
    align: 'left',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Assinatura',
      tab: 'content',
      fields: [
        {
          path: 'closing',
          label: 'Despedida',
          control: { kind: 'text', maxLength: 80 },
        },
        {
          path: 'name',
          label: 'Nome',
          control: { kind: 'text', maxLength: 120 },
        },
        {
          path: 'role',
          label: 'Cargo',
          control: { kind: 'text', maxLength: 120 },
        },
        {
          path: 'contact',
          label: 'Contato',
          control: { kind: 'text', maxLength: 200 },
        },
        { path: 'photo', label: 'Foto', control: { kind: 'image' } },
        alignField(),
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [colorField('color', 'Cor do texto')],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(SignatureView),
})
