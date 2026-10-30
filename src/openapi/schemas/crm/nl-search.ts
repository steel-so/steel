import { z } from 'zod'
import { dto } from '../../common'
import { CrmLeadDTO } from '../public'
import { CrmCompanyDTO, CrmPersonDTO } from './people'

/**
 * Resultado da busca em linguagem natural em leads, pessoas e empresas
 * (`types/crm-nl-search.d.ts`). Mesmo desenho da busca de oportunidades.
 */

const interpretation = z.array(z.string()).meta({
  description: 'Como a pergunta foi lida, em frases curtas.',
})

const truncated = z.boolean().meta({
  description: 'Havia mais de 200 resultados; só os 200 primeiros vêm.',
})

export const CrmNlLeadSearchResultDTO = dto(
  'CrmNlLeadSearchResult',
  z.object({
    query: z.string().meta({ example: 'leads do WhatsApp parados há 7 dias' }),
    interpretation,
    filter: z.record(z.string(), z.unknown()).meta({
      description:
        'Filtro estruturado que rodou: `status`, `stage`, `scoreMin`, `scoreMax`, `createdWithinDays`, `stalledForDays`, `ownedByMe`, `unassigned`, `hasEmail`, `hasPhone`, `channelContains`, `sourceContains`, `cityContains`, `textContains` e `sort` (os ausentes não restringem).',
    }),
    items: z.array(CrmLeadDTO),
    truncated,
  }),
)

export const CrmNlPersonSearchResultDTO = dto(
  'CrmNlPersonSearchResult',
  z.object({
    query: z.string().meta({ example: 'diretores com e-mail da Acme' }),
    interpretation,
    filter: z.record(z.string(), z.unknown()).meta({
      description:
        'Filtro estruturado que rodou: `createdWithinDays`, `stalledForDays`, `hasEmail`, `hasPhone`, `hasCompany`, `companyContains`, `jobTitleContains`, `cityContains`, `textContains` e `sort`.',
    }),
    items: z.array(CrmPersonDTO),
    truncated,
  }),
)

export const CrmNlCompanySearchResultDTO = dto(
  'CrmNlCompanySearchResult',
  z.object({
    query: z
      .string()
      .meta({ example: 'empresas de alimentos com mais de 50 funcionários' }),
    interpretation,
    filter: z.record(z.string(), z.unknown()).meta({
      description:
        'Filtro estruturado que rodou: `icp`, `employeesMin`, `employeesMax`, `arrMin`, `arrMax`, `hasCnpj`, `enriched`, `activityContains`, `domainContains`, `createdWithinDays`, `stalledForDays`, `ownedByMe`, `unassigned`, `textContains` e `sort`.',
    }),
    items: z.array(CrmCompanyDTO),
    truncated,
  }),
)
