"use client"

import { useState, type ReactElement } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type ConfirmActionProps = {
  /** The element that opens the dialog (usually the icon/delete button). */
  trigger: ReactElement
  title: string
  /** Say what is lost, e.g. "Os 12 membros da lista também serão removidos." */
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void | Promise<void>
}

/**
 * Shared confirmation for destructive actions. Wrap the existing button:
 *
 *   <ConfirmAction
 *     trigger={<Button variant="ghost" size="icon" aria-label="Remover lista">…</Button>}
 *     title="Remover esta lista?"
 *     description="Todos os membros serão removidos. Não dá para desfazer."
 *     onConfirm={() => remove.mutate(id)}
 *   />
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Excluir",
  cancelLabel = "Cancelar",
  destructive = true,
  pending = false,
  onConfirm,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={async () => {
              await onConfirm()
              setOpen(false)
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
