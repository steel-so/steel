'use client'

import { Add01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { useCreateSdKbArticle } from '@/src/hooks/use-sd-knowledge'

/** Cria um rascunho vazio e abre o editor (port do `WikiCreatePageButton`). */
export function SdKbCreateButton({
  workspaceId,
  workspaceSlug,
  categoryId,
  className,
}: {
  workspaceId: string
  workspaceSlug: string
  categoryId?: string
  className?: string
}) {
  const router = useRouter()
  const create = useCreateSdKbArticle(workspaceId)

  return (
    <Button
      size='sm'
      data-tour='sd-kb-new'
      className={className}
      disabled={create.isPending}
      onClick={() =>
        create.mutate(categoryId ? { categoryId } : {}, {
          onSuccess: (article) =>
            router.push(
              `/${workspaceSlug}/servicedesk/knowledge/${article.id}`,
            ),
          onError: notify.error,
        })
      }
    >
      <SteelIcon icon={Add01Icon} strokeWidth={2} />
      Novo artigo
    </Button>
  )
}
