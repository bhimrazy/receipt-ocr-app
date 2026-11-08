// Creates USERS accounts (load-<i>@example.com); safe to re-run. Receipts and plan limits come from seed.sql.
import exec from "k6/execution";
import { check } from "k6";
import { emailOf, PASSWORD, postJson, USERS } from "./lib.js";

export const options = {
  scenarios: {
    seed: { executor: "shared-iterations", vus: 5, iterations: USERS, maxDuration: "10m" },
  },
  thresholds: { checks: ["rate==1"] },
};

export default function () {
  const i = exec.scenario.iterationInTest;
  const res = postJson(
    "/api/auth/sign-up/email",
    { email: emailOf(i), password: PASSWORD, name: `Load ${i}` },
    i,
  );
  // 422: the account exists from an earlier run.
  check(res, { "account ready": (r) => r.status === 200 || r.status === 422 });
}
