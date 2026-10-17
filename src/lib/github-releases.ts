import { GITHUB_RELEASES_REPO, GITHUB_RELEASES_TOKEN } from '@/lib/env/server'

/** Repositório padrão das releases do Steel (CD cria uma por deploy). */
export const DEFAULT_RELEASES_REPO = 'steel-so/steel'
const API = 'https://api.github.com'
const TIMEOUT_MS = 10_000

export interface GithubRelease {
  tag: string
  name: string | null
  body: string
  url: string
  publishedAt: string | null
}

export class GithubReleasesError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GithubReleasesError'
  }
}

function headers(): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'steel-admin-changelog',
    ...(GITHUB_RELEASES_TOKEN
      ? { Authorization: `Bearer ${GITHUB_RELEASES_TOKEN}` }
      : {}),
  }
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new GithubReleasesError(
      cause instanceof Error ? cause.message : 'network error',
    )
  }
  if (!res.ok) {
    throw new GithubReleasesError(`GitHub API ${res.status}`, res.status)
  }
  return (await res.json()) as T
}

export function releasesRepo(): string {
  return GITHUB_RELEASES_REPO ?? DEFAULT_RELEASES_REPO
}

/** Última release publicada (não draft/prerelease). */
export async function fetchLatestRelease(): Promise<GithubRelease> {
  const data = await getJson<{
    tag_name: string
    name: string | null
    body: string | null
    html_url: string
    published_at: string | null
  }>(`/repos/${releasesRepo()}/releases/latest`)
  return {
    tag: data.tag_name,
    name: data.name,
    body: data.body ?? '',
    url: data.html_url,
    publishedAt: data.published_at,
  }
}

/** Mensagens dos commits entre duas tags (até 250, limite da API). */
export async function fetchCompareCommitMessages(
  base: string,
  head: string,
): Promise<string[]> {
  const data = await getJson<{ commits: { commit: { message: string } }[] }>(
    `/repos/${releasesRepo()}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  )
  return data.commits.map((c) => c.commit.message)
}
