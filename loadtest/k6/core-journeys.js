// Core member journeys under load: sign-in, discovery feed, swipes, matches, chat.
//
// Requires pre-provisioned, fully onboarded test accounts in a NON-production environment (never run against
// production data). Provide them as a JSON file of [{ "email": "...", "password": "..." }]:
//   k6 run -e BASE_URL=https://api.staging.example -e USERS_FILE=./users.json loadtest/k6/core-journeys.js
//
// Thresholds are the proposed SLOs from docs/runbooks/performance.md (the BRD sets no numeric targets).
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const users = new SharedArray('users', () => JSON.parse(open(__ENV.USERS_FILE || './users.json')));

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: Number(__ENV.PEAK_VUS || 200) },
        { duration: '10m', target: Number(__ENV.PEAK_VUS || 200) },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<300', 'p(99)<800'],
    'http_req_duration{kind:write}': ['p(95)<500', 'p(99)<1200'],
    'http_req_duration{name:recommendations}': ['p(95)<400'],
    checks: ['rate>0.99'],
  },
};

const json = (token) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });

function login(u) {
  const res = http.post(`${BASE}/v1/auth/login`, JSON.stringify({
    identifier: u.email, password: u.password,
    device: { installationId: `k6-${exec.vu.idInTest}-install`, platform: 'android', appVersion: 'k6' },
  }), { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'write', name: 'login' } });
  check(res, { 'login 200': (r) => r.status === 200 });
  return res.json('tokens.accessToken');
}

let token = null;

export default function () {
  const u = users[(exec.vu.idInTest - 1) % users.length];
  if (!token) token = login(u);
  if (!token) return;
  const p = json(token);

  group('discovery', () => {
    const feed = http.get(`${BASE}/v1/recommendations?surface=smart`, { ...p, tags: { kind: 'read', name: 'recommendations' } });
    check(feed, { 'feed 200': (r) => r.status === 200 });
    const items = feed.status === 200 ? feed.json('items') || [] : [];
    for (const card of items.slice(0, 3)) {
      const action = Math.random() < 0.35 ? 'like' : 'pass';
      const r = http.post(`${BASE}/v1/likes`, JSON.stringify({ targetId: card.userId, action }), { ...p, tags: { kind: 'write', name: 'swipe' } });
      // 429 = the account's daily like limit (a product rule, not an error).
      check(r, { 'swipe accepted': (x) => x.status === 201 || x.status === 429 });
      sleep(1 + Math.random() * 2);
    }
  });

  group('chat', () => {
    const list = http.get(`${BASE}/v1/conversations`, { ...p, tags: { kind: 'read', name: 'conversations' } });
    check(list, { 'conversations 200': (r) => r.status === 200 });
    const conv = list.status === 200 ? (list.json('items') || [])[0] : null;
    if (!conv) return;
    check(http.get(`${BASE}/v1/conversations/${conv.id}/messages`, { ...p, tags: { kind: 'read', name: 'messages' } }), { 'messages 200': (r) => r.status === 200 });
    const send = http.post(`${BASE}/v1/conversations/${conv.id}/messages`, JSON.stringify({ clientMessageId: `k6-${exec.vu.idInTest}-${exec.vu.iterationInScenario}`, kind: 'text', body: 'Load test message' }), { ...p, tags: { kind: 'write', name: 'send_message' } });
    check(send, { 'send accepted': (r) => r.status === 201 || r.status === 429 });
  });

  sleep(2 + Math.random() * 3);
}
