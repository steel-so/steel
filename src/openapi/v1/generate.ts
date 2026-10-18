import { serializeOpenApiDocument } from '../document'
import { openApiVersion } from '../generate'
import { buildOpenApiV1Document } from './document'

/** File served at `/dev/api/v1/openapi.json`, the SDK's source. */
export const OPENAPI_V1_OUTPUT = 'public/openapi.v1.json'

/** Exact content of `public/openapi.v1.json` for the current code. */
export function generateOpenApiV1Json(root: string): string {
  return serializeOpenApiDocument(
    buildOpenApiV1Document({ version: openApiVersion(root) }),
  )
}
