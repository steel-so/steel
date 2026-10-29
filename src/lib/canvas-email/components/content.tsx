import type { CSSProperties } from 'react'
import { Img, Link, Text } from 'react-email'
import { defineComponent } from '@/src/lib/canvas/registry'
import { spacing } from '@/src/lib/canvas/values'
import { BLOCK_LAYOUT_SECTION, colorField, linkField } from '../inspector'
import { BlockFrame, emailHref, SHOWN } from '../primitives'
import {
  type EmailPostItem,
  type EmailPostsProps,
  postsSchema,
} from '../schemas'
import { EMAIL_PALETTE, type EmailViewProps, emailColor } from '../theme'
import { emailBody, emailView } from './layout'

/**
 * Content blocks of the e-mail catalog (newsletter2 nl2-digest-ai): the
 * "Lista de posts" the newsletter digest fills from a Site blog or an RSS
 * feed — title, excerpt, image and link of each post, side by side or
 * stacked. Same rules as every e-mail block: tables, inline styles, no
 * hover/JS, images with alt text.
 */

export const POSTS_BLOCK = 'email.posts'

/** A post the block shows (an item without title is dropped on output). */
function visibleItems(items: EmailPostItem[], editing: boolean) {
  return editing ? items : items.filter((item) => item.title.trim())
}

function PostRow({
  item,
  vertical,
  showImage,
  linkLabel,
  accent,
  textColor,
  font,
  last,
}: {
  item: EmailPostItem
  vertical: boolean
  showImage: boolean
  linkLabel: string
  accent: string
  textColor: string
  font: string
  last: boolean
}) {
  const href = emailHref(item.link)
  const src = showImage ? item.image.src.trim() : ''
  const image = src ? (
    <Link href={href}>
      <Img
        src={src}
        alt={item.image.alt || item.title}
        width={vertical ? 560 : 120}
        style={{
          display: 'block',
          width: vertical ? '100%' : 120,
          maxWidth: '100%',
          height: 'auto',
          borderRadius: 8,
          border: 0,
        }}
      />
    </Link>
  ) : null
  const details = (
    <>
      <Text
        style={{
          margin: 0,
          fontSize: 17,
          lineHeight: '24px',
          fontWeight: 600,
          fontFamily: font,
        }}
      >
        <Link href={href} style={{ color: textColor, textDecoration: 'none' }}>
          {item.title || 'Título do post'}
        </Link>
      </Text>
      {item.excerpt ? (
        <Text
          style={{
            margin: '6px 0 0',
            fontSize: 14,
            lineHeight: '21px',
            fontFamily: font,
            color: EMAIL_PALETTE.fg2,
          }}
        >
          {item.excerpt}
        </Text>
      ) : null}
      {href && linkLabel ? (
        <Link
          href={href}
          style={{
            display: 'inline-block',
            marginTop: 8,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: font,
            color: accent,
          }}
        >
          {`${linkLabel} →`}
        </Link>
      ) : null}
    </>
  )
  const cell: CSSProperties = {
    padding: last ? '16px 0 0' : '16px 0',
    borderBottom: last ? undefined : `1px solid ${EMAIL_PALETTE.stroke}`,
    verticalAlign: 'top',
  }
  if (vertical || !image) {
    return (
      <tr>
        <td style={cell}>
          {image ? <div style={{ marginBottom: 12 }}>{image}</div> : null}
          {details}
        </td>
      </tr>
    )
  }
  return (
    <tr>
      <td style={cell}>
        <table
          role='presentation'
          width='100%'
          cellPadding={0}
          cellSpacing={0}
          border={0}
        >
          <tbody>
            <tr>
              <td
                width={136}
                valign='top'
                className='ec-stack'
                style={{ width: 136, paddingRight: 16, verticalAlign: 'top' }}
              >
                {image}
              </td>
              <td valign='top' style={{ verticalAlign: 'top' }}>
                {details}
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  )
}

function PostsView(props: EmailViewProps<EmailPostsProps>) {
  const { node, editing } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  // In the editor every item shows (the schema keeps at least one); the
  // output drops the ones without a title and the block when none is left.
  const items = visibleItems(p.items, editing)
  if (items.length === 0) return null
  const accent = emailColor(p.accentColor, tokens) ?? EMAIL_PALETTE.fg
  const textColor = emailColor(p.color, tokens) ?? EMAIL_PALETTE.fg
  return (
    <BlockFrame {...props}>
      <table
        role='presentation'
        width='100%'
        cellPadding={0}
        cellSpacing={0}
        border={0}
      >
        <tbody>
          {items.map((item, index) => (
            <PostRow
              key={index}
              item={item}
              vertical={p.layout === 'vertical'}
              showImage={p.showImages}
              linkLabel={p.linkLabel}
              accent={accent}
              textColor={textColor}
              font={body.fontStack}
              last={index === items.length - 1}
            />
          ))}
        </tbody>
      </table>
    </BlockFrame>
  )
}

/** One empty post, as the inspector adds it. */
export function emptyPostItem(): EmailPostItem {
  return {
    title: 'Título do post',
    excerpt: 'Um resumo curto do que o leitor vai encontrar.',
    image: { src: '', alt: '' },
    link: { type: 'url', value: 'https://' },
  }
}

export const postsDefinition = defineComponent<EmailPostsProps>({
  type: POSTS_BLOCK,
  label: 'Lista de posts',
  icon: 'posts',
  category: 'Relacionamento',
  keywords: ['blog', 'artigos', 'rss', 'resumo', 'notícias', 'newsletter'],
  propsSchema: postsSchema,
  defaultProps: () => ({
    items: [emptyPostItem(), emptyPostItem()],
    layout: 'horizontal',
    showImages: true,
    linkLabel: 'Ler mais',
    accentColor: 'token:primary',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Posts',
      tab: 'content',
      fields: [
        {
          path: 'items',
          label: 'Posts',
          control: {
            kind: 'list',
            itemLabel: 'Post',
            max: 12,
            fields: [
              {
                path: 'title',
                label: 'Título',
                control: { kind: 'text', maxLength: 200 },
              },
              {
                path: 'excerpt',
                label: 'Resumo',
                control: { kind: 'textarea', maxLength: 400, rows: 2 },
              },
              { path: 'image', label: 'Imagem', control: { kind: 'image' } },
              linkField('link', 'Link do post'),
            ],
          },
        },
        {
          path: 'linkLabel',
          label: 'Texto do link',
          control: { kind: 'text', maxLength: 40 },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        {
          path: 'layout',
          label: 'Disposição',
          control: {
            kind: 'segmented',
            options: [
              { value: 'horizontal', label: 'Lado a lado' },
              { value: 'vertical', label: 'Empilhado' },
            ],
          },
        },
        {
          path: 'showImages',
          label: 'Mostrar imagens',
          control: { kind: 'toggle' },
        },
        colorField('color', 'Cor do título'),
        colorField('accentColor', 'Cor do link'),
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(PostsView),
})
