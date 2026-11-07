const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Receipt, group, job and request ids are UUIDs; anything else can't match one. */
export const isUuid = (id: string) => UUID.test(id);
