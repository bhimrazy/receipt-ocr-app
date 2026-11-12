/** History filtered to one group. */
export const groupHistoryHref = (groupId: string) =>
  `/app/history?${new URLSearchParams({ group: groupId })}`;
