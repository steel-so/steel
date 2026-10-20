import { z } from 'zod'

export const UserRoleValues = [
  'PRODUCT_MANAGER',
  'ENGINEERING_MANAGER',
  'DESIGNER',
  'DEVELOPER',
  'FOUNDER_EXECUTIVE',
  'OPERATIONS_MANAGER',
  'OTHER',
] as const

export const UserGoalValues = [
  'ROADMAP',
  'SPRINTS',
  'CROSS_FUNCTIONAL',
  'REPLACE_TOOL',
  'EXPLORING',
]

const usernameRegex = /^[a-z0-9._-]+$/

// PABX extension/device. An empty string clears the field. The device is a
// number; the extension may carry letters (ex.: `1122S`).
const pabxField = (label: string, pattern: RegExp, hint: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || null : v),
    z
      .string()
      .regex(pattern, `${label} deve conter ${hint}`)
      .nullable()
      .optional(),
  )

export const UpdateUserSchema = z.object({
  name: z
    .string()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(100)
    .optional(),
  email: z.email('E-mail inválido').optional(),
  username: z
    .string()
    .min(3, 'Username deve ter ao menos 3 caracteres')
    .max(39, 'Username deve ter no máximo 39 caracteres')
    .regex(
      usernameRegex,
      'Username deve conter apenas letras minúsculas, números, ponto, hífen e underscore',
    )
    .optional(),
  coverImage: z
    .string()
    .refine(
      (v) => v.startsWith('/') || z.url().safeParse(v).success,
      'URL de capa inválida',
    )
    .optional(),
  pabxExtension: pabxField(
    'Ramal',
    /^[A-Za-z0-9]{1,20}$/,
    'apenas letras e números',
  ),
  pabxDeviceId: pabxField('Device', /^\d{1,20}$/, 'apenas números'),
})

export const SaveRoleSchema = z.object({
  role: z.enum(UserRoleValues),
})

export const SaveGoalsSchema = z.object({
  goals: z
    .array(z.enum(UserGoalValues))
    .min(1, 'Selecione ao menos um objetivo'),
})

export const SaveProfileSchema = z.object({
  name: z
    .string()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(50, 'Nome deve ter no máximo 50 caracteres'),
})

export const AcceptConsentSchema = z.object({
  acceptedTerms: z.literal(true, {
    message: 'Você precisa aceitar os Termos de Serviço',
  }),
  acceptedPrivacy: z.literal(true, {
    message: 'Você precisa aceitar a Política de Privacidade',
  }),
})

export type UpdateUserDTO = z.infer<typeof UpdateUserSchema>
export type SaveRoleDTO = z.infer<typeof SaveRoleSchema>
export type SaveGoalsDTO = z.infer<typeof SaveGoalsSchema>
export type SaveProfileDTO = z.infer<typeof SaveProfileSchema>
export type AcceptConsentDTO = z.infer<typeof AcceptConsentSchema>
