'use client'

import { useCanvasStoreApi } from '@/app/_components/canvas/use-canvas'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSiteNewsletters } from '@/src/hooks/use-site-newsletters'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import { useSiteEditor } from './site-editor-context'

const NONE = '__none'

/**
 * Inspector control of `site.newsletter-subscribe` and
 * `site.newsletter-issues`: picks one of the workspace's ACTIVE CRM
 * newsletters (the name is kept in the node as a snapshot).
 */
export function SiteNewsletterPicker({ value, node }: CustomControlProps) {
  const { workspaceId, slug } = useSiteEditor()
  const store = useCanvasStoreApi()
  const newsletters = useSiteNewsletters(workspaceId)
  const list = newsletters.data ?? []
  const id = typeof value === 'string' && value ? value : NONE
  const current = list.find((item) => item.id === id)
  const issuesElement = node.type === 'site.newsletter-issues'

  return (
    <div className='grid gap-1.5'>
      <Select
        value={id}
        onValueChange={(next) => {
          if (typeof next !== 'string') return
          const picked = list.find((item) => item.id === next)
          store.dispatch({
            kind: 'update',
            id: node.id,
            set: picked
              ? { newsletterId: picked.id, newsletterName: picked.name }
              : { newsletterId: '', newsletterName: '' },
          })
        }}
      >
        <SelectTrigger
          size='sm'
          className='w-full text-xs'
          aria-label='Newsletter'
          disabled={newsletters.isLoading}
        >
          <SelectValue>
            {() =>
              newsletters.isLoading
                ? 'Carregando…'
                : (current?.name ??
                  (id === NONE
                    ? 'Escolha uma newsletter'
                    : 'Newsletter indisponível'))
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value={NONE}>Nenhuma</SelectItem>
          {list.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className='text-[11px] text-muted-foreground leading-relaxed'>
        {list.length === 0 && !newsletters.isLoading
          ? 'Nenhuma newsletter ativa. '
          : id !== NONE && !current && !newsletters.isLoading
            ? 'Esta newsletter foi arquivada ou excluída. '
            : issuesElement && current && !current.archiveEnabled
              ? 'O arquivo público desta newsletter está desligado: nenhuma edição aparece. '
              : issuesElement
                ? 'Mostra as edições já enviadas, com link para o arquivo público. '
                : 'Quem assinar entra na lista de assinantes da newsletter. '}
        <a
          href={`/${slug}/crm/newsletters`}
          target='_blank'
          rel='noopener'
          className='font-medium text-primary underline-offset-4 hover:underline'
        >
          Gerenciar newsletters
        </a>
      </p>
    </div>
  )
}
