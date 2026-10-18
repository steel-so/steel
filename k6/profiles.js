// Latency budgets, per environment (same scheme as Nexo's k6/profiles.js).
//
// The same scripts run against two very different targets: `next start` on
// loopback (performance.yml's k6-local job, a dev machine) and homologação or
// production over the internet, with TLS, two proxies and — from the GitHub
// runners — a round trip between the US and Brazil. One set of numbers cannot
// describe both: the loopback budget fails remotely for reasons that are not
// the server's, and the remote budget would hide a real regression locally.
//
// The profile is inferred from BASE_URL, so nobody has to remember a flag.
// K6_PROFILE overrides it (a tunnel, a private address). TTFB
// (`http_req_waiting`) measures the server; the end-to-end duration also
// carries the body transfer, which is what the remote budget relaxes (the
// landing page needs ~850ms end to end from a US runner with ~40ms of server
// time). TTFB_BUDGET_MS / DURATION_P95_MS still override the smoke numbers.

const LOOPBACK =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|nginx|nextjs-app|steel-app(-\d+)?)([:/]|$)/

export function profileFor(baseUrl) {
  if (__ENV.K6_PROFILE) return __ENV.K6_PROFILE
  return LOOPBACK.test(baseUrl) ? 'local' : 'remote'
}

const BUDGETS = {
  smoke: {
    local: { ttfbP95: 500, durationP95: 500, failed: 0.01 },
    remote: { ttfbP95: 500, durationP95: 1500, durationP99: 3000, failed: 0.01 },
  },
  api: {
    local: { ttfbP95: 500, durationP95: 500, failed: 0.05 },
    remote: { ttfbP95: 500, durationP95: 1500, failed: 0.05 },
  },
  load: {
    local: { durationP95: 800, durationP99: 1500, failed: 0.01 },
    remote: { durationP95: 2500, durationP99: 5000, failed: 0.01 },
  },
  // capacity-test.js: what "holding up" means at thousands of VUs (ADR 0037).
  capacity: {
    local: { ttfbP95: 1000, durationP95: 1500, durationP99: 3000, failed: 0.01 },
    remote: { ttfbP95: 1500, durationP95: 2500, durationP99: 5000, failed: 0.01 },
  },
}

/** Per-request ceiling of the inline `check()`s, in milliseconds. */
const SINGLE_REQUEST_MS = { local: 500, remote: 1500 }

export function budget(kind, baseUrl) {
  const byProfile = BUDGETS[kind]
  if (!byProfile) throw new Error(`unknown budget "${kind}"`)
  const base = byProfile[profileFor(baseUrl)] ?? byProfile.local
  return {
    ...base,
    ...(__ENV.TTFB_BUDGET_MS ? { ttfbP95: Number(__ENV.TTFB_BUDGET_MS) } : {}),
    ...(__ENV.DURATION_P95_MS
      ? { durationP95: Number(__ENV.DURATION_P95_MS) }
      : {}),
  }
}

/** k6 `thresholds` for a budget kind. */
export function thresholds(kind, baseUrl) {
  const b = budget(kind, baseUrl)
  const duration = [`p(95)<${b.durationP95}`]
  if (b.durationP99) duration.push(`p(99)<${b.durationP99}`)
  return {
    ...(b.ttfbP95 ? { http_req_waiting: [`p(95)<${b.ttfbP95}`] } : {}),
    http_req_duration: duration,
    http_req_failed: [`rate<${b.failed}`],
  }
}

export function requestCeilingMs(baseUrl) {
  return SINGLE_REQUEST_MS[profileFor(baseUrl)] ?? SINGLE_REQUEST_MS.local
}
