import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { requestCeilingMs, thresholds } from './profiles.js';

// Capacity test towards the 6,000-VU goal (ADR 0038). Each VU behaves like a
// visitor with think time between pages — unlike a stress loop, where one VU
// fires the next request the moment the previous one returns (Nexo's
// EXPERIMENT-LOG: one VU without sleep made 258 requests in 3s). Read the
// result as "N people browsing at once", and the throughput as the number
// that compares runs.
//
// NEVER run it against an environment without the owner's go-ahead, and
// never from CI on a schedule: at the top of the ramp it is a real load on the
// host. See docs/runbooks/app-replicas.md, section "Teste de capacidade".
//
//   k6 run k6/capacity-test.js                                  # breakpoint, 1,000 -> 6,000 VUs
//   PROFILE=hold VUS=3000 HOLD=5m k6 run k6/capacity-test.js    # plateau
//   BASE_URL=https://homologacao.stratustelecom.com.br SITE_SLUG=demo k6 run k6/capacity-test.js
//
// Env:
//   BASE_URL        target (default http://localhost:3001); the latency budget
//                   follows it (k6/profiles.js, K6_PROFILE overrides)
//   PROFILE         breakpoint (steps up to MAX) | hold (ramp to VUS, hold)
//   STEP, MAX       breakpoint step size and ceiling (default 1000, 6000)
//   STEP_HOLD       how long each breakpoint step holds (default 3m)
//   VUS, RAMP, HOLD hold profile (default 2000, 5m, 5m)
//   THINK_MIN/MAX   seconds between a visitor's pages (default 3, 15)
//   SITE_SLUG       a published site, served at /s/<slug> ('use cache' path)
//   SESSION_COOKIE  session token of a test account for signed-in pages;
//   WORKSPACE_SLUG  with it, /<workspace> and its ServiceDesk/CRM/zap pages
//   SESSION_COOKIE_NAME  default __Secure-better-auth.session_token over
//                   https, better-auth.session_token over http
//
// One generator is one source IP, and the app rate-limits per IP: past a few
// hundred VUs the API answers 429. Those are counted apart (`rate_limited`),
// not as failures — what this test measures is whether the replicas keep
// serving pages within budget. A 429 storm on the pages themselves means the
// generator, not the app, is what needs spreading out (several k6 hosts).

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const PROFILE = __ENV.PROFILE || 'breakpoint';
const STEP = Number(__ENV.STEP || 1000);
const MAX = Number(__ENV.MAX || 6000);
const STEP_HOLD = __ENV.STEP_HOLD || '3m';
const VUS = Number(__ENV.VUS || 2000);
const RAMP = __ENV.RAMP || '5m';
const HOLD = __ENV.HOLD || '5m';
const THINK_MIN = Number(__ENV.THINK_MIN || 3);
const THINK_MAX = Number(__ENV.THINK_MAX || 15);
const SITE_SLUG = __ENV.SITE_SLUG || '';
const SESSION_COOKIE = __ENV.SESSION_COOKIE || '';
const WORKSPACE_SLUG = __ENV.WORKSPACE_SLUG || '';
const SESSION_COOKIE_NAME =
  __ENV.SESSION_COOKIE_NAME ||
  (BASE_URL.startsWith('https://')
    ? '__Secure-better-auth.session_token'
    : 'better-auth.session_token');
const CEILING_MS = requestCeilingMs(BASE_URL) * 2;

// Ask for compression like a browser does: uncompressed pages would saturate
// the generator's uplink before the server (Nexo measured ~470 KB vs ~42 KB).
const HEADERS = { 'Accept-Encoding': 'gzip, br' };
const SIGNED_IN = SESSION_COOKIE && WORKSPACE_SLUG;

const rateLimited = new Counter('rate_limited');

// 2xx/3xx are expected (the proxy redirects some pages); 429 is counted on
// its own above; everything else is a failure.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

function breakpointStages() {
  const stages = [];
  for (let target = STEP; target <= MAX; target += STEP) {
    stages.push({ duration: '2m', target }); // climb
    stages.push({ duration: STEP_HOLD, target }); // hold the step
  }
  stages.push({ duration: '1m', target: 0 });
  return stages;
}

const SCENARIOS = {
  breakpoint: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: breakpointStages(),
    gracefulRampDown: '30s',
  },
  hold: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: RAMP, target: VUS },
      { duration: HOLD, target: VUS },
      { duration: '1m', target: 0 },
    ],
    gracefulRampDown: '30s',
  },
};

const budget = thresholds('capacity', BASE_URL);

export const options = {
  scenarios: { visitors: SCENARIOS[PROFILE] ?? SCENARIOS.breakpoint },
  thresholds: {
    ...budget,
    // Stop the breakpoint once the replicas clearly gave up (5% failing for a
    // minute): the step before is the ceiling, the rest is noise.
    http_req_failed: [
      ...budget.http_req_failed,
      { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '1m' },
    ],
  },
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const PUBLIC_PAGES = ['/', '/sign-in', '/pricing', '/docs', '/status', '/changelog'];

function think() {
  sleep(THINK_MIN + Math.random() * Math.max(THINK_MAX - THINK_MIN, 0));
}

function visit(path, params = {}) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers: { ...HEADERS, ...(params.headers || {}) },
    redirects: 0,
    tags: { name: params.name || path },
  });
  if (res.status === 429) {
    rateLimited.add(1);
    return res;
  }
  check(res, {
    [`${params.name || path} is 2xx/3xx`]: (r) => r.status >= 200 && r.status < 400,
    [`${params.name || path} under ${CEILING_MS}ms`]: (r) => r.timings.duration < CEILING_MS,
  });
  return res;
}

export default function () {
  group('public', () => {
    visit(PUBLIC_PAGES[Math.floor(Math.random() * PUBLIC_PAGES.length)]);
    think();
    visit('/api/auth/get-session');
  });
  think();

  if (SITE_SLUG) {
    group('site', () => {
      visit(`/s/${SITE_SLUG}`, { name: '/s/[siteSlug]' });
    });
    think();
  }

  if (SIGNED_IN) {
    const auth = { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_COOKIE}` };
    group('signed-in', () => {
      const pages = ['', '/servicedesk', '/crm', '/zap'];
      const page = pages[Math.floor(Math.random() * pages.length)];
      visit(`/${WORKSPACE_SLUG}${page}`, {
        headers: auth,
        name: `/[workspace]${page}`,
      });
    });
    think();
  }
}
