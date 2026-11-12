import type {
  GroupColor,
  MembershipChange,
  ReceiptGroup,
  ReceiptGroupRef,
} from "@receipt-ocr/core/group-rules";
import { apiRequest as call } from "@/lib/api-request";

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
