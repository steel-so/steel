'use client'

import { useMutation } from '@tanstack/react-query'
import { apiFetch } from './_fetch'

export interface OpenLeadWhatsappResult {
  conversationId: string
  contactId: string
}

/** Opens (or reuses) the WhatsApp conversation of a CRM lead's phone. */
export function useOpenLeadWhatsapp(workspaceId: string, leadId: string) {
  return useMutation({
    mutationFn: (phone?: string) =>
      apiFetch<OpenLeadWhatsappResult>(
        `/api/workspaces/${workspaceId}/crm/leads/${leadId}/whatsapp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(phone ? { phone } : {}),
        },
        'Não foi possível abrir a conversa',
      ),
  })
}
