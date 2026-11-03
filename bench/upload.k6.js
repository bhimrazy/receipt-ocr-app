// Upload load test for POST /api/receipts. k6 is a standalone binary, not an npm package.
//   k6 run -e BASE_URL=http://localhost:3004 bench/upload.k6.js
// Run against a stack with the fixture OCR provider (OCR_PROVIDER=fixture) so the numbers are our
// ingest path (auth, quota, storage, DB), not Gemini. Each VU signs up its own user (own workspace
// and quota window); raise plan limits for the test database or expect 429s, reported separately.
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3004";
const image = open("./fixtures/long-groceries.png", "b");
const ingest = new Trend("upload_ms", true);
const limited = new Counter("upload_rate_limited");

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "1m", target: 20 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    upload_ms: ["p(95)<3000"],
  },
};

let signedIn = false;

function signUp() {
  const email = `k6-${__VU}-${Date.now()}@example.com`;
  const res = http.post(
    `${BASE_URL}/api/auth/sign-up/email`,
    JSON.stringify({ email, password: "k6-password-123", name: `k6 ${__VU}` }),
    { headers: { "Content-Type": "application/json", Origin: BASE_URL } },
  );
  check(res, { "signed up": (r) => r.status === 200 });
  signedIn = res.status === 200;
}

export default function uploadReceipt() {
  if (!signedIn) signUp();
  const res = http.post(
    `${BASE_URL}/api/receipts`,
    { file: http.file(image, "receipt.png", "image/png") },
    { headers: { Origin: BASE_URL }, responseCallback: http.expectedStatuses(200, 201, 429) },
  );
  ingest.add(res.timings.duration);
  if (res.status === 429) limited.add(1);
  check(res, { accepted: (r) => r.status === 200 || r.status === 201 });
}
