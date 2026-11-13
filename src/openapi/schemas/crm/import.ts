import { z } from 'zod'
import { dto } from '../../common'

/** DTO of the CSV import of leads, people and companies. */
export const CrmImportResultDTO = dto(
  'CrmImportResult',
  z.object({
    created: z.number().int().meta({ description: 'Registros criados.' }),
    rejected: z
      .array(
        z.object({
          row: z.number().int().meta({
            description:
              'Número da linha de dados (1 = primeira após o cabeçalho).',
          }),
          name: z.string(),
          reason: z.string().meta({
            example: 'Já existe uma pessoa com este e-mail ou telefone',
          }),
        }),
      )
      .meta({
        description:
          'Linhas não criadas: inválidas, repetidas no arquivo ou já cadastradas.',
      }),
  }),
)
