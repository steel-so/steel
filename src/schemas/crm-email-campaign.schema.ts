import z from 'zod'

export const CreateCrmEmailCampaignSchema = z
  .object({
    subject: z.string().min(1, 'Assunto é obrigatório').max(300),
    // Free HTML, or rendered from a visual-builder template (`templateId`).
    contentHtml: z
      .string()
      .min(1, 'Conteúdo é obrigatório')
      .max(200_000)
      .optional(),
    contentJson: z.string().max(200_000).optional(),
    templateId: z.string().min(1).optional(),
    // Tracked URL that replaces `{{campaign_link}}` at send time.
    campaignLink: z.url().max(2000).optional(),
    fromAddress: z.email(),
    recipientScope: z.enum(['ALL', 'SELECTED']),
    // Quando SELECTED, os três conjuntos abaixo são unidos (dedupe por
    // e-mail) — combinar pessoas + várias listas + e-mails avulsos numa
    // campanha só, igual ao original.
    mailingListIds: z.array(z.string()).optional(),
    // Dynamic segments (CRM > Segmentação), resolved when the campaign is built.
    segmentIds: z.array(z.string().min(1)).max(50).optional(),
    personIds: z.array(z.string()).optional(),
    extraEmails: z.array(z.email()).optional(),
    scheduledAt: z.coerce.date().optional(),
  })
  // "Selecionados" sem ninguém marcado já disparou para o workspace inteiro:
  // seleção vazia é erro, nunca fallback para "todos".
  .refine(
    (data) =>
      data.recipientScope === 'ALL' ||
      (data.personIds?.length ?? 0) > 0 ||
      (data.mailingListIds?.length ?? 0) > 0 ||
      (data.segmentIds?.length ?? 0) > 0 ||
      (data.extraEmails?.length ?? 0) > 0,
    {
      message: 'Selecione ao menos um destinatário',
      path: ['recipientScope'],
    },
  )
  .refine((data) => Boolean(data.contentHtml) || Boolean(data.templateId), {
    message: 'Conteúdo é obrigatório',
    path: ['contentHtml'],
  })

export type CreateCrmEmailCampaignDTO = z.infer<
  typeof CreateCrmEmailCampaignSchema
>

export const UpdateCrmEmailCampaignSchema = z.object({
  subject: z.string().min(1, 'Assunto é obrigatório').max(300).optional(),
  contentHtml: z.string().min(1).max(200_000).optional(),
  contentJson: z.string().max(200_000).optional(),
  fromAddress: z.email().optional(),
  scheduledAt: z.coerce.date().optional(),
})

export type UpdateCrmEmailCampaignDTO = z.infer<
  typeof UpdateCrmEmailCampaignSchema
>
