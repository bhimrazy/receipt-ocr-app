import type {
  GroupColor,
  MembershipChange,
  ReceiptGroup,
  ReceiptGroupRef,
} from "@receipt-ocr/core/group-rules";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) return { ok: false, error: json?.error ?? "Something went wrong. Try again." };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export const createGroupRequest = (name: string, color: GroupColor) =>
  call<{ group: ReceiptGroup }>("/api/groups", "POST", { name, color });

export const updateGroupRequest = (id: string, patch: { name?: string; color?: GroupColor }) =>
  call<{ group: ReceiptGroup }>(`/api/groups/${id}`, "PATCH", patch);

export const deleteGroupRequest = (id: string) => call<{ ok: true }>(`/api/groups/${id}`, "DELETE");

export const addReceiptsRequest = (groupId: string, receiptIds: string[]) =>
  call<MembershipChange>(`/api/groups/${groupId}/receipts`, "POST", { receiptIds });

export const setReceiptInGroupRequest = (receiptId: string, groupId: string, inGroup: boolean) =>
  call<{ groups: ReceiptGroupRef[] }>(
    `/api/receipts/${receiptId}/groups`,
    inGroup ? "POST" : "DELETE",
    {
      groupId,
    },
  );
