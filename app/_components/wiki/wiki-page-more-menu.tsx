'use client'

import {
  Archive02Icon,
  Copy01Icon,
  Download01Icon,
  Link01Icon,
  MoreHorizontalIcon,
  SquareLock02Icon,
  SquareUnlock02Icon,
  StarIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type WikiExportKind = 'pdf' | 'html' | 'markdown' | 'word' | 'image'

const EXPORTS: { kind: WikiExportKind; label: string }[] = [
  { kind: 'pdf', label: 'PDF' },
  { kind: 'html', label: 'HTML' },
  { kind: 'markdown', label: 'Markdown' },
  { kind: 'word', label: 'Word' },
  { kind: 'image', label: 'Imagem' },
]

export interface WikiPageMoreMenuProps {
  fullWidth: boolean
  onFullWidthChange: (value: boolean) => void
  fixedToolbar: boolean
  onFixedToolbarChange: (value: boolean) => void
  onCopyMarkdown: () => void
  onDuplicate: () => void
  onExport: (kind: WikiExportKind) => void
  onArchive: () => void
  /** False while the page is locked for the viewer. */
  canEdit: boolean
  duplicating?: boolean
  /**
   * The top bar's own buttons, repeated here for phones where the bar only
   * has room for publish and this menu.
   */
  compact?: {
    favorite: boolean
    onToggleFavorite: () => void
    onCopyLink: () => void
    locked: boolean
    canManageLock: boolean
    onToggleLock: () => void
  }
}

/** The "⋯" menu of a wiki page. */
export function WikiPageMoreMenu({
  fullWidth,
  onFullWidthChange,
  fixedToolbar,
  onFixedToolbarChange,
  onCopyMarkdown,
  onDuplicate,
  onExport,
  onArchive,
  canEdit,
  duplicating,
  compact,
}: WikiPageMoreMenuProps) {
  const [confirmArchive, setConfirmArchive] = useState(false)

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Mais opções'
              title='Mais opções'
            />
          }
        >
          <SteelIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-60'>
          {compact && (
            <DropdownMenuGroup className='sm:hidden'>
              <DropdownMenuItem onClick={compact.onToggleFavorite}>
                <SteelIcon icon={StarIcon} strokeWidth={2} />
                {compact.favorite
                  ? 'Remover dos favoritos'
                  : 'Adicionar aos favoritos'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={compact.onCopyLink}>
                <SteelIcon icon={Link01Icon} strokeWidth={2} />
                Copiar link
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!compact.canManageLock}
                onClick={compact.onToggleLock}
              >
                <SteelIcon
                  icon={compact.locked ? SquareUnlock02Icon : SquareLock02Icon}
                  strokeWidth={2}
                />
                {compact.locked ? 'Desbloquear edição' : 'Bloquear edição'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </DropdownMenuGroup>
          )}
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={fullWidth}
              onCheckedChange={(checked) => onFullWidthChange(checked)}
            >
              Largura total
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={fixedToolbar}
              onCheckedChange={(checked) => onFixedToolbarChange(checked)}
            >
              Barra de ferramentas fixa
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onCopyMarkdown}>
              <SteelIcon icon={Copy01Icon} strokeWidth={2} />
              Copiar como Markdown
            </DropdownMenuItem>
            <DropdownMenuItem disabled={duplicating} onClick={onDuplicate}>
              <SteelIcon icon={Copy01Icon} strokeWidth={2} />
              Fazer uma cópia
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SteelIcon icon={Download01Icon} strokeWidth={2} />
                Exportar
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {EXPORTS.map((item) => (
                  <DropdownMenuItem
                    key={item.kind}
                    onClick={() => onExport(item.kind)}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant='destructive'
            disabled={!canEdit}
            onClick={() => setConfirmArchive(true)}
          >
            <SteelIcon icon={Archive02Icon} strokeWidth={2} />
            Arquivar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar esta página?</AlertDialogTitle>
            <AlertDialogDescription>
              A página e as subpáginas dela saem da Wiki.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                setConfirmArchive(false)
                onArchive()
              }}
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
