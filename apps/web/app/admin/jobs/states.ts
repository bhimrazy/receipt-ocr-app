export const STATE_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  dead: "Dead",
  cancelled: "Cancelled",
};

export type BadgeTone = "secondary" | "success" | "warning" | "destructive" | "default";

export const stateVariant = (state: string): BadgeTone =>
  state === "dead"
    ? "destructive"
    : state === "succeeded"
      ? "success"
      : state === "running"
        ? "default"
        : "secondary";
