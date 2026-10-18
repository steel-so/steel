import fs from 'node:fs/promises'
import path from 'node:path'
import { toPublicOpenApi } from '@/src/lib/docs/public-openapi'
import { SITE_URL } from '@/src/lib/seo/site'

let cached: string | null = null

// The public API v1 document with this site as the server (its paths
// already carry `/api/v1`). The CLI's SDK
// is generated from it. Read once per process: it only changes with a deploy.
export async function GET() {
  if (!cached) {
    const raw = await fs.readFile(
      path.join(process.cwd(), 'public', 'openapi.v1.json'),
      'utf-8',
    )
    cached = JSON.stringify(toPublicOpenApi(JSON.parse(raw), SITE_URL, ''))
  }
  return new Response(cached, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
