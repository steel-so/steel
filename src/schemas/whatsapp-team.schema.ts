import { z } from 'zod'

export const WHATSAPP_TEAM_ROLES = ['LEADER', 'AGENT'] as const
export type WhatsAppTeamRole = (typeof WHATSAPP_TEAM_ROLES)[number]

const TeamMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(WHATSAPP_TEAM_ROLES).default('AGENT'),
})

export const CreateWhatsAppTeamSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(80),
  description: z.string().trim().max(500).optional(),
  members: z.array(TeamMemberSchema).max(200).default([]),
})
export type CreateWhatsAppTeamInput = z.infer<typeof CreateWhatsAppTeamSchema>

/** `members`, when sent, replaces the whole member list. */
export const UpdateWhatsAppTeamSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  members: z.array(TeamMemberSchema).max(200).optional(),
})
export type UpdateWhatsAppTeamInput = z.infer<typeof UpdateWhatsAppTeamSchema>

/** PATCH /conversations/[conversationId]/team — `null` removes the team. */
export const SetWhatsAppConversationTeamSchema = z.object({
  teamId: z.string().min(1).nullable(),
})
