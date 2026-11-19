/** Flag da plataforma (liga/desliga) como o painel admin a enxerga. */
export interface PlatformFlagDTO {
  id: string
  key: string
  name: string
  description: string | null
  /** Ligada para todos os workspaces. */
  enabled: boolean
  /** Ligada para os workspaces beta. */
  betaEnabled: boolean
  /** Quantos workspaces têm liberação explícita. */
  workspaceCount: number
  createdAt: string
  updatedAt: string
}

export interface PlatformFlagWorkspaceDTO {
  id: string
  name: string
  slug: string
  beta: boolean
  /** Só preenchido quando a consulta é de uma flag específica. */
  granted?: boolean
}
