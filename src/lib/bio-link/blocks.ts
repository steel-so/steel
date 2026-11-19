import { createId } from '@paralleldrive/cuid2'
import type { BioBlockDTO } from '@/src/schemas/bio-link.schema'
import {
  BIO_NETWORK_LABELS,
  type BioNetwork,
  resolveBioDestination,
  youtubeVideoId,
} from './destination'

/** What the editor's "Adicionar" menu can put on the page. */
export type BioAddKind = BioNetwork | 'header' | 'form' | 'video'

const DEFAULT_TITLES: Record<BioNetwork, string> = {
  custom: 'Novo link',
  whatsapp: 'Fale conosco no WhatsApp',
  instagram: 'Siga no Instagram',
  facebook: 'Curta no Facebook',
  site: 'Visite nosso site',
  youtube: 'Nosso canal no YouTube',
  tiktok: 'Siga no TikTok',
  email: 'Envie um e-mail',
  phone: 'Ligue para nós',
}

/** Ready-made buttons first, then the generic blocks. */
export const BIO_ADD_OPTIONS: { kind: BioAddKind; label: string }[] = [
  { kind: 'whatsapp', label: BIO_NETWORK_LABELS.whatsapp },
  { kind: 'instagram', label: BIO_NETWORK_LABELS.instagram },
  { kind: 'facebook', label: BIO_NETWORK_LABELS.facebook },
  { kind: 'tiktok', label: BIO_NETWORK_LABELS.tiktok },
  { kind: 'youtube', label: BIO_NETWORK_LABELS.youtube },
  { kind: 'site', label: 'Site' },
  { kind: 'email', label: BIO_NETWORK_LABELS.email },
  { kind: 'phone', label: BIO_NETWORK_LABELS.phone },
  { kind: 'custom', label: 'Link personalizado' },
  { kind: 'header', label: 'Título de seção' },
  { kind: 'form', label: 'Formulário do CRM' },
  { kind: 'video', label: 'Vídeo do YouTube' },
]

export function createBioBlock(
  kind: BioAddKind,
  id: string = createId(),
): BioBlockDTO {
  switch (kind) {
    case 'header':
      return { id, type: 'header', active: true, title: 'Novidades' }
    case 'form':
      return {
        id,
        type: 'form',
        active: true,
        title: 'Fale com a gente',
        formToken: '',
        mode: 'link',
      }
    case 'video':
      return { id, type: 'video', active: true, title: null, url: '' }
    default:
      return {
        id,
        type: 'link',
        active: true,
        network: kind,
        title: DEFAULT_TITLES[kind],
        value: '',
        message: null,
      }
  }
}

const NETWORK_PROBLEMS: Record<BioNetwork, string> = {
  custom: 'Informe um endereço válido, como meusite.com.br',
  site: 'Informe um endereço válido, como meusite.com.br',
  whatsapp: 'Informe o número com DDD, como (11) 91234-5678',
  instagram: 'Informe o @usuário ou o link do perfil',
  facebook: 'Informe o nome da página ou o link',
  tiktok: 'Informe o @usuário ou o link do perfil',
  youtube: 'Informe o @canal ou o link do canal',
  email: 'Informe um e-mail válido',
  phone: 'Informe o telefone com DDD',
}

/** Why a block cannot be saved yet, or `null` when it is fine. Mirrors the
 * server schema, so the editor can warn before the request. */
export function bioBlockProblem(block: BioBlockDTO): string | null {
  if (block.startsAt && block.endsAt) {
    if (Date.parse(block.startsAt) >= Date.parse(block.endsAt)) {
      return 'O fim precisa ser depois do início'
    }
  }
  switch (block.type) {
    case 'header':
      return block.title.trim() ? null : 'Informe o título'
    case 'video':
      return youtubeVideoId(block.url)
        ? null
        : 'Use um link de vídeo do YouTube'
    case 'form':
      if (!block.title.trim()) return 'Informe o título'
      return block.formToken ? null : 'Escolha um formulário'
    case 'link':
      if (!block.title.trim()) return 'Informe o título'
      return resolveBioDestination(block)
        ? null
        : NETWORK_PROBLEMS[block.network]
    default:
      return null
  }
}

/** ISO instant → value of an `<input type="datetime-local">` (browser zone). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Value of an `<input type="datetime-local">` → ISO instant (or `null`). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Short line under a block's title in the editor list. */
export function bioBlockSummary(block: BioBlockDTO): string {
  switch (block.type) {
    case 'header':
      return 'Título de seção'
    case 'video':
      return block.url || 'Vídeo do YouTube'
    case 'form':
      return block.mode === 'embed'
        ? 'Formulário na página'
        : 'Botão para o formulário'
    case 'link':
      return block.value || BIO_NETWORK_LABELS[block.network]
    default:
      return ''
  }
}
