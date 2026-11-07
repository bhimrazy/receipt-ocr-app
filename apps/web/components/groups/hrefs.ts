/** `?select=1` turns History into selection mode for bulk "Add to group". */
export const SELECT_PARAM = "select";

/** History filtered to one group. */
export const groupHistoryHref = (groupId: string) =>
  `/app/history?${new URLSearchParams({ group: groupId })}`;
