import http from 'k6/http';
import { check, sleep } from 'k6';
import { budget, thresholds } from './profiles.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
// Same scheme as smoke-test.js: TTFB asserts the server, the end-to-end
// budget follows the environment profile (k6/profiles.js).
const TTFB_BUDGET_MS = budget('api', BASE_URL).ttfbP95;

// Accept 2xx-4xx as expected — this test intentionally hits unauthenticated endpoints.
// Only 5xx and connection errors should count as failures.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export const options = {
  vus: 1,
  duration: '15s',
  thresholds: thresholds('api', BASE_URL),
};

export default function () {
  // GET /api/auth/get-session — returns 200 with null session when unauthenticated
  const meRes = http.get(`${BASE_URL}/api/auth/get-session`);
  check(meRes, {
    'GET /api/auth/get-session returns 200': (r) => r.status === 200,
    'GET /api/auth/get-session TTFB within budget': (r) => r.timings.waiting < TTFB_BUDGET_MS,
  });
  sleep(1);

  // POST /api/auth/sign-in/email — expects 4xx with empty body
  const signInRes = http.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    JSON.stringify({ email: '', password: '' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(signInRes, {
    'POST /api/auth/sign-in/email returns 4xx': (r) => r.status >= 400 && r.status < 500,
    'POST /api/auth/sign-in/email TTFB within budget': (r) => r.timings.waiting < TTFB_BUDGET_MS,
  });
  sleep(1);
}
