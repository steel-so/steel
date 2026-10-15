'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  CrmDashboardSettings,
  DashboardTemplate,
} from '@/src/schemas/crm-dashboard.schema'
import type {
  CrmDashboardDTO,
  CrmDashboardLookupsDTO,
  CrmDashboardTvLinkDTO,
} from '@/types/crm-dashboard'
import { apiFetch, apiFetchJson, apiSend, isApiErrorCode } from './_fetch'

function dashboardsUrl(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/crm/dashboards`
}

/** One CRM dashboard (title, screens and TV rotation), with refetch. */
export function useCrmDashboard(workspaceId: string, dashboardId: string) {
  const [dashboard, setDashboard] = useState<CrmDashboardDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    // No workspace = not a CRM dashboard (the WhatsApp ones have no screens).
    if (!workspaceId) return
    try {
      setDashboard(
        await apiFetch<CrmDashboardDTO>(
          `${dashboardsUrl(workspaceId)}/${dashboardId}`,
          undefined,
          'Não foi possível carregar o painel.',
        ),
      )
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro de rede.')
    }
  }, [workspaceId, dashboardId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { dashboard, setDashboard, error, refetch }
}

export function updateCrmDashboardSettings(
  workspaceId: string,
  dashboardId: string,
  settings: CrmDashboardSettings,
): Promise<CrmDashboardDTO> {
  return apiFetchJson<CrmDashboardDTO>(
    `${dashboardsUrl(workspaceId)}/${dashboardId}`,
    'PATCH',
    { settings },
    'Não foi possível salvar as telas do painel.',
  )
}

/** Creates a ready-made dashboard ("Vendas — TV"). */
export function createCrmDashboardFromTemplate(
  workspaceId: string,
  template: DashboardTemplate,
): Promise<CrmDashboardDTO> {
  return apiFetchJson<CrmDashboardDTO>(
    `${dashboardsUrl(workspaceId)}/templates`,
    'POST',
    { template },
    'Não foi possível criar o painel.',
  )
}

/* ------------------------------- TV links ------------------------------- */

function tvLinksUrl(workspaceId: string, dashboardId: string): string {
  return `${dashboardsUrl(workspaceId)}/${dashboardId}/tv-links`
}

/** Live TV links of a dashboard (only loads while `enabled`). */
export function useCrmDashboardTvLinks(
  workspaceId: string,
  dashboardId: string,
  enabled: boolean,
) {
  const [links, setLinks] = useState<CrmDashboardTvLinkDTO[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The member is not an owner/admin of the CRM. */
  const [forbidden, setForbidden] = useState(false)

  const refetch = useCallback(async () => {
    setIsLoading(true)
    try {
      setLinks(
        await apiFetch<CrmDashboardTvLinkDTO[]>(
          tvLinksUrl(workspaceId, dashboardId),
          undefined,
          'Não foi possível carregar os links da TV.',
        ),
      )
      setError(null)
      setForbidden(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro de rede.')
      setForbidden(isApiErrorCode(e, 'FORBIDDEN'))
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, dashboardId])

  useEffect(() => {
    if (enabled) void refetch()
  }, [enabled, refetch])

  return { links, setLinks, isLoading, error, forbidden, refetch }
}

export function createCrmDashboardTvLink(
  workspaceId: string,
  dashboardId: string,
  name: string,
): Promise<CrmDashboardTvLinkDTO> {
  return apiFetchJson<CrmDashboardTvLinkDTO>(
    tvLinksUrl(workspaceId, dashboardId),
    'POST',
    { name },
    'Não foi possível criar o link da TV.',
  )
}

export function revokeCrmDashboardTvLink(
  workspaceId: string,
  dashboardId: string,
  linkId: string,
): Promise<void> {
  return apiSend(
    `${tvLinksUrl(workspaceId, dashboardId)}/${linkId}`,
    { method: 'DELETE' },
    'Não foi possível revogar o link.',
  )
}

/* -------------------------------- lookups ------------------------------- */

const lookupCache = new Map<
  string,
  { at: number; promise: Promise<CrmDashboardLookupsDTO> }
>()
/** Widgets of one screen share one request; names refresh every minute. */
const LOOKUP_TTL_MS = 60_000

export function fetchDashboardLookups(
  workspaceId: string,
): Promise<CrmDashboardLookupsDTO> {
  const now = Date.now()
  const hit = lookupCache.get(workspaceId)
  if (hit && now - hit.at < LOOKUP_TTL_MS) return hit.promise
  const promise = apiFetch<CrmDashboardLookupsDTO>(
    `${dashboardsUrl(workspaceId)}/lookups`,
    undefined,
    'Não foi possível carregar os nomes.',
  )
  lookupCache.set(workspaceId, { at: now, promise })
  promise.catch(() => lookupCache.delete(workspaceId))
  return promise
}

/** Only for tests: forgets the shared lookups. */
export function clearDashboardLookupsCache() {
  lookupCache.clear()
}

/**
 * Stage, pipeline and member names of the workspace. `initial` (the TV
 * boot already carries them) skips the request.
 */
export function useDashboardLookups(
  workspaceId: string | null,
  initial?: CrmDashboardLookupsDTO,
): CrmDashboardLookupsDTO | null {
  const [lookups, setLookups] = useState<CrmDashboardLookupsDTO | null>(
    initial ?? null,
  )
  useEffect(() => {
    if (initial || !workspaceId) return
    let active = true
    fetchDashboardLookups(workspaceId)
      .then((value) => {
        if (active) setLookups(value)
      })
      .catch(() => {
        // Without names the widgets fall back to the raw values.
      })
    return () => {
      active = false
    }
  }, [workspaceId, initial])
  return lookups
}
