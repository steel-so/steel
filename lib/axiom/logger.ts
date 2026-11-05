import { Logger } from '@axiomhq/logging'
import axiomClient from '@/lib/axiom/axiom'
import { capFieldKeys, flattenNestedFields } from '@/lib/axiom/log-fields'
import { buildLogTransports } from '@/lib/axiom/transports'
import { withTraceContext } from '@/lib/otel/trace-context'
import {
  NEXT_PUBLIC_AXIOM_DATASET,
  NEXT_PUBLIC_AXIOM_TOKEN,
  NODE_ENV,
} from '@/lib/env/env'

const transports = buildLogTransports({
  axiom: axiomClient,
  token: NEXT_PUBLIC_AXIOM_TOKEN,
  dataset: NEXT_PUBLIC_AXIOM_DATASET,
  console: NODE_ENV !== 'production',
})

// Nested objects under `fields` become one JSON string column each, and
// keys outside the allowlist fold into `detail`: the dataset keeps a fixed
// set of columns (limit: 257) whatever new code logs.
export const logger = new Logger({
  transports,
  formatters: [withTraceContext, flattenNestedFields, capFieldKeys],
})
