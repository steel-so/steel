import type { CnpjProfile } from '@/src/lib/cnpj/provider'
import { createKeyedCache } from './_cache'

/**
 * Perfil da Receita por CNPJ (14 dígitos). Só respostas bem-sucedidas entram:
 * o mesmo CNPJ não volta às APIs públicas (que limitam por IP) por 24 h.
 */
export const CrmCnpjCache = createKeyedCache<CnpjProfile>({
  prefix: 'crm:cnpj:v2:',
  ttl: 24 * 60 * 60,
  name: 'crm_cnpj',
})
