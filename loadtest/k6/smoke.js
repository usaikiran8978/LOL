// Unauthenticated smoke: run against any environment after a deploy.
//   k6 run -e BASE_URL=https://api.staging.example loadtest/k6/smoke.js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<300'] },
};

export default function () {
  check(http.get(`${BASE}/health/ready`), { 'ready 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/v1/config`), { 'config 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/v1/catalog/interests`, { headers: { 'Accept-Language': 'en' } }), { 'catalog <500': (r) => r.status < 500 });
}
