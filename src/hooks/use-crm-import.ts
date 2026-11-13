'use client'

import { useMutation } from '@tanstack/react-query'
import type {
  CrmImportDTO,
  CrmImportResultDTO,
} from '@/src/schemas/crm-import.schema'
import { apiFetchJson } from './_fetch'

/** CSV import of leads, people or companies (rows parsed in the browser). */
export function useImportCrmRecords(workspaceId: string) {
  return useMutation({
    mutationFn: (dto: CrmImportDTO) =>
      apiFetchJson<CrmImportResultDTO>(
        `/api/workspaces/${workspaceId}/crm/import`,
        'POST',
        dto,
        'Erro ao importar o arquivo',
      ),
  })
}
