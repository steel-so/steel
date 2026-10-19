import http from 'k6/http';
import { check, sleep } from 'k6';
import { budget, thresholds } from './profiles.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// Server responsiveness is asserted on TTFB (`timings.waiting`): it measures
// the app, not the pipe. The end-to-end budget comes from the environment
// profile (k6/profiles.js): 500ms on loopback, relaxed for a remote target,
// where the body transfer is dominated by runner <-> host distance.
const TTFB_BUDGET_MS = budget('smoke', BASE_URL).ttfbP95;

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: thresholds('smoke', BASE_URL),
};

// Public pages only. `/contact` no longer exists (it rendered a soft 404 and,
// with the proxy active, redirects to /sign-in) — the public contact page is
// `/talk-to-sales`.
const pages = ['/', '/sign-in', '/sign-up', '/talk-to-sales'];

export default function () {
  for (const page of pages) {
    const res = http.get(`${BASE_URL}${page}`, { redirects: 0 });
    check(res, {
      [`${page} returns 200`]: (r) => r.status === 200,
      [`${page} TTFB under ${TTFB_BUDGET_MS}ms`]: (r) =>
        r.timings.waiting < TTFB_BUDGET_MS,
    });
    sleep(1);
  }
}
