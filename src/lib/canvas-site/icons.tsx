import type { IconSvgElement } from '@hugeicons/react'
import {
  Analytics01Icon,
  ArrowRight02Icon,
  Award01Icon,
  Briefcase01Icon,
  Calendar03Icon,
  Call02Icon,
  Cancel01Icon,
  ChartIncreaseIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CodeIcon,
  DeliveryTruck01Icon,
  Facebook01Icon,
  FlashIcon,
  Github01Icon,
  Globe02Icon,
  HeadsetIcon,
  Home01Icon,
  Idea01Icon,
  InstagramIcon,
  Layers01Icon,
  Leaf01Icon,
  Linkedin01Icon,
  Location01Icon,
  LockIcon,
  Mail01Icon,
  Menu01Icon,
  Message01Icon,
  NewTwitterIcon,
  PaintBrush01Icon,
  PinterestIcon,
  PlayIcon,
  QuoteDownIcon,
  Rocket01Icon,
  Settings02Icon,
  Shield01Icon,
  ShoppingCart01Icon,
  StarIcon,
  Target02Icon,
  ThreadsIcon,
  Tick02Icon,
  TiktokIcon,
  UserGroup02Icon,
  Wallet01Icon,
  WhatsappIcon,
  YoutubeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { createElement } from 'react'

/**
 * Icons a site can use (`site.icon`, list markers, buttons, social links):
 * a curated Hugeicons set rendered as inline SVG — no icon font, no client
 * JS. Names are stable ids stored in documents; never rename one.
 */
export const SITE_ICONS = {
  check: { label: 'Confirmado', svg: CheckmarkCircle02Icon },
  tick: { label: 'Visto', svg: Tick02Icon },
  arrow: { label: 'Seta', svg: ArrowRight02Icon },
  star: { label: 'Estrela', svg: StarIcon },
  rocket: { label: 'Foguete', svg: Rocket01Icon },
  flash: { label: 'Raio', svg: FlashIcon },
  idea: { label: 'Ideia', svg: Idea01Icon },
  target: { label: 'Alvo', svg: Target02Icon },
  award: { label: 'Prêmio', svg: Award01Icon },
  chart: { label: 'Crescimento', svg: ChartIncreaseIcon },
  analytics: { label: 'Análise', svg: Analytics01Icon },
  shield: { label: 'Segurança', svg: Shield01Icon },
  lock: { label: 'Cadeado', svg: LockIcon },
  clock: { label: 'Relógio', svg: Clock01Icon },
  calendar: { label: 'Calendário', svg: Calendar03Icon },
  users: { label: 'Equipe', svg: UserGroup02Icon },
  headset: { label: 'Atendimento', svg: HeadsetIcon },
  message: { label: 'Mensagem', svg: Message01Icon },
  mail: { label: 'E-mail', svg: Mail01Icon },
  phone: { label: 'Telefone', svg: Call02Icon },
  location: { label: 'Localização', svg: Location01Icon },
  globe: { label: 'Globo', svg: Globe02Icon },
  home: { label: 'Casa', svg: Home01Icon },
  briefcase: { label: 'Maleta', svg: Briefcase01Icon },
  settings: { label: 'Engrenagem', svg: Settings02Icon },
  layers: { label: 'Camadas', svg: Layers01Icon },
  code: { label: 'Código', svg: CodeIcon },
  brush: { label: 'Pincel', svg: PaintBrush01Icon },
  cart: { label: 'Carrinho', svg: ShoppingCart01Icon },
  wallet: { label: 'Carteira', svg: Wallet01Icon },
  truck: { label: 'Entrega', svg: DeliveryTruck01Icon },
  leaf: { label: 'Folha', svg: Leaf01Icon },
  quote: { label: 'Citação', svg: QuoteDownIcon },
  play: { label: 'Play', svg: PlayIcon },
  menu: { label: 'Menu', svg: Menu01Icon },
  close: { label: 'Fechar', svg: Cancel01Icon },
} as const satisfies Record<string, { label: string; svg: IconSvgElement }>

export type SiteIconName = keyof typeof SITE_ICONS
export const SITE_ICON_NAMES = Object.keys(SITE_ICONS) as [
  SiteIconName,
  ...SiteIconName[],
]

export const SOCIAL_NETWORKS = {
  facebook: { label: 'Facebook', svg: Facebook01Icon },
  instagram: { label: 'Instagram', svg: InstagramIcon },
  linkedin: { label: 'LinkedIn', svg: Linkedin01Icon },
  x: { label: 'X (Twitter)', svg: NewTwitterIcon },
  youtube: { label: 'YouTube', svg: YoutubeIcon },
  tiktok: { label: 'TikTok', svg: TiktokIcon },
  whatsapp: { label: 'WhatsApp', svg: WhatsappIcon },
  github: { label: 'GitHub', svg: Github01Icon },
  pinterest: { label: 'Pinterest', svg: PinterestIcon },
  threads: { label: 'Threads', svg: ThreadsIcon },
} as const satisfies Record<string, { label: string; svg: IconSvgElement }>

export type SocialNetwork = keyof typeof SOCIAL_NETWORKS
export const SOCIAL_NETWORK_NAMES = Object.keys(SOCIAL_NETWORKS) as [
  SocialNetwork,
  ...SocialNetwork[],
]

/** Inline SVG of an icon. Decorative (`aria-hidden`) unless `label` is
 * given, then it is announced as an image. */
export function IconSvg({
  icon,
  label,
  className,
}: {
  icon: IconSvgElement
  label?: string
  className?: string
}) {
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true, focusable: 'false' as const }
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      fill='none'
      className={className}
      {...a11y}
    >
      {icon.map(([tag, attrs], index) =>
        createElement(tag, { ...attrs, key: index }),
      )}
    </svg>
  )
}
