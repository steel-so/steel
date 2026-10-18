import {
  API_V1_REFERENCE_DESCRIPTION,
  API_V1_REFERENCE_TITLE,
  buildApiReferenceHtml,
} from '@/src/lib/docs/api-reference'
import { SITE_URL } from '@/src/lib/seo/site'

// Reference of the public API v1 (`public/openapi.v1.json`), rendered by
// Scalar like `/dev/api`; both script tags carry the request's CSP nonce.
export function GET(request: Request) {
  const html = buildApiReferenceHtml({
    nonce: request.headers.get('x-nonce') ?? '',
    specUrl: '/dev/api/v1/openapi.json',
    canonicalUrl: `${SITE_URL}/dev/api/v1`,
    title: API_V1_REFERENCE_TITLE,
    description: API_V1_REFERENCE_DESCRIPTION,
  })
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
