/** Query string → plain object, skipping the empty parameters. */
export function queryObject(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of new URL(url).searchParams) {
    if (value !== '') out[key] = value
  }
  return out
}
