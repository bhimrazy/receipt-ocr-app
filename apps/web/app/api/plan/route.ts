import { NextResponse } from "next/server";
import { canManageBilling } from "@/lib/billing";
import { annotateCaller, jsonError, withRequestEvent } from "@/lib/http";
import { getCurrentPlan } from "@/lib/plan-limits";
import { getActiveScope } from "@/lib/session";

export type CurrentPlanResponse = { plan: "free" | "pro"; owner: boolean };

/** The active workspace's plan, so the static pricing page can mark "Your plan". */
export const GET = withRequestEvent(
  { event: "plan.current", route: "/api/plan", routine: true },
  async (_request, _context, event) => {
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const { plan } = await getCurrentPlan();
    return NextResponse.json(
      { plan, owner: canManageBilling(scope.role) } satisfies CurrentPlanResponse,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
