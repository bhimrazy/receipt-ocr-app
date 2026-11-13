/** History filtered to one group. */
export const groupHistoryHref = (groupId: string) =>
  `/app/receipts?${new URLSearchParams({ group: groupId })}`;
