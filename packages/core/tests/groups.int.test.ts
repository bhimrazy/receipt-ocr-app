/**
 * Receipt groups against real Postgres. Skipped unless INTEGRATION=1; run with
 * `bun run --filter @receipt-ocr/core test:int` after `bun run db:migrate`.
 */
import {
  eq,
  member,
  organization,
  receiptGroupMembers,
  receiptGroups,
  receipts,
  sql,
  user,
} from "@receipt-ocr/db";
import { Cause, Effect, Exit, ManagedRuntime, Option } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addReceiptsToGroup,
  createGroup,
  deleteGroup,
  groupsOfReceipt,
  listGroups,
  MAX_GROUPS_PER_RECEIPT,
  notFoundOnForeignKey,
  MAX_GROUPS_PER_WORKSPACE,
  releaseMemberGroups,
  removeReceiptsFromGroup,
  setReceiptGroup,
  updateGroup,
} from "../src/groups";
import { removeMember } from "../src/admin";
import { AppLayer, type AppServices } from "../src/index";
import { ReceiptRepo, type ReceiptScope } from "../src/repository";
import { Db } from "../src/services";
import { ensurePersonalWorkspace } from "../src/workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

/** The failure's tag and message, or "ok". */
async function outcome<A, E extends { _tag: string; message?: string }>(
  effect: Effect.Effect<A, E, AppServices>,
) {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return { tag: "ok" as const };
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw Cause.squash(exit.cause);
  return { tag: failure.value._tag, message: failure.value.message };
}

const tag = `grp-${Date.now()}`;

async function createUser(name: string) {
  const id = `${tag}-${name}`;
  await db((d) =>
    d.insert(user).values({ id, name, email: `${id}@example.com`, emailVerified: true }),
  );
  const orgId = await run(ensurePersonalWorkspace({ id, name, email: `${id}@example.com` }));
  if (!orgId) throw new Error("no workspace");
  return { userId: id, organizationId: orgId, role: "owner" } satisfies ReceiptScope;
}

async function joinAs(scope: ReceiptScope, name: string, role: "admin" | "member") {
  const id = `${tag}-${name}`;
  await db(async (d) => {
    await d.insert(user).values({ id, name, email: `${id}@example.com`, emailVerified: true });
    await d.insert(member).values({
      id: `${id}-m`,
      organizationId: scope.organizationId,
      userId: id,
      role,
      createdAt: new Date(),
    });
  });
  return { userId: id, organizationId: scope.organizationId, role } satisfies ReceiptScope;
}

async function seedReceipt(scope: ReceiptScope, merchant: string) {
  const [row] = await db((d) =>
    d
      .insert(receipts)
      .values({
        organizationId: scope.organizationId,
        userId: scope.userId,
        merchant,
        status: "completed",
        total: "10.00",
      })
      .returning({ id: receipts.id }),
  );
  return row!.id;
}

const create = (scope: ReceiptScope, name: string, color = "green") =>
  run(createGroup(scope, { name, color: color as "green" }));

describe.skipIf(!enabled)("receipt groups against Postgres", () => {
  let owner: ReceiptScope;
  let other: ReceiptScope;
  let memberA: ReceiptScope;
  let adminA: ReceiptScope;
  let receiptA1: string;
  let receiptA2: string;
  let receiptB: string;

  beforeAll(async () => {
    owner = await createUser("owner");
    other = await createUser("other");
    memberA = await joinAs(owner, "member", "member");
    adminA = await joinAs(owner, "admin", "admin");
    receiptA1 = await seedReceipt(owner, "Café Berlin");
    receiptA2 = await seedReceipt(memberA, "Hotel Berlin");
    receiptB = await seedReceipt(other, "Other workspace");
  });

  afterAll(async () => {
    await db(async (d) => {
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await runtime.dispose();
  });

  it("creates groups, lists them by name with counts, and normalises whitespace", async () => {
    const group = await create(owner, "  Berlin   trip ");
    expect(group).toMatchObject({ name: "Berlin trip", color: "green", canManage: true });
    await create(owner, "accounting", "blue");
    const groups = await run(listGroups(owner));
    expect(groups.map((g) => g.name)).toEqual(["accounting", "Berlin trip"]);
    expect(groups.every((g) => g.receiptCount === 0)).toBe(true);
  });

  it("names are unique per workspace ignoring case, and free in another workspace", async () => {
    expect(await outcome(createGroup(owner, { name: "BERLIN TRIP", color: "red" }))).toMatchObject({
      tag: "Conflict",
    });
    expect((await create(other, "Berlin trip")).name).toBe("Berlin trip");
    const accounting = (await run(listGroups(owner))).find((g) => g.name === "accounting")!;
    expect(await outcome(updateGroup(owner, accounting.id, { name: "berlin Trip" }))).toMatchObject(
      {
        tag: "Conflict",
      },
    );
    // Changing only the case of its own name is allowed.
    expect((await run(updateGroup(owner, accounting.id, { name: "Accounting" }))).name).toBe(
      "Accounting",
    );
  });

  it("rejects empty, long, hidden-character names and unknown colours", async () => {
    for (const name of ["", "   ", "x".repeat(61), "a‮b"]) {
      expect(await outcome(createGroup(owner, { name, color: "green" }))).toMatchObject({
        tag: "InvalidInput",
      });
    }
    expect(
      await outcome(createGroup(owner, { name: "Fine", color: "chartreuse" as "green" })),
    ).toMatchObject({ tag: "InvalidInput" });
    expect((await create(owner, "x".repeat(60))).name).toHaveLength(60);
  });

  it("adds and removes receipts in bulk, counting what changed", async () => {
    const trip = (await run(listGroups(owner))).find((g) => g.name === "Berlin trip")!;
    expect(await run(addReceiptsToGroup(owner, trip.id, [receiptA1, receiptA2]))).toEqual({
      changed: 2,
      unchanged: 0,
      atLimit: 0,
      notFound: 0,
    });
    // Again, plus a duplicate id in the same call: nothing new.
    expect(
      await run(addReceiptsToGroup(memberA, trip.id, [receiptA1, receiptA1.toUpperCase()])),
    ).toMatchObject({ changed: 0, unchanged: 1 });
    expect((await run(listGroups(owner))).find((g) => g.id === trip.id)?.receiptCount).toBe(2);
    expect(await run(groupsOfReceipt(owner, receiptA1))).toEqual([
      { id: trip.id, name: "Berlin trip", color: "green" },
    ]);
    // Any member may take receipts out, including someone else's upload.
    expect(await run(removeReceiptsFromGroup(memberA, trip.id, [receiptA1]))).toMatchObject({
      changed: 1,
    });
    await run(addReceiptsToGroup(owner, trip.id, [receiptA1]));
  });

  it("bulk calls take 1 to 100 UUIDs", async () => {
    const trip = (await run(listGroups(owner))).find((g) => g.name === "Berlin trip")!;
    const many = Array.from({ length: 101 }, () => crypto.randomUUID());
    for (const ids of [[], many, ["not-a-uuid"], "nope"]) {
      expect(await outcome(addReceiptsToGroup(owner, trip.id, ids))).toMatchObject({
        tag: "InvalidInput",
      });
    }
    expect(await outcome(addReceiptsToGroup(owner, "not-a-uuid", [receiptA1]))).toMatchObject({
      tag: "InvalidInput",
    });
  });

  it("workspace isolation: no cross-workspace adds, reads, renames or deletes", async () => {
    const tripA = (await run(listGroups(owner))).find((g) => g.name === "Berlin trip")!;
    const tripB = (await run(listGroups(other))).find((g) => g.name === "Berlin trip")!;

    // B's receipt into A's group, by A: not this workspace's receipt.
    expect(await run(addReceiptsToGroup(owner, tripA.id, [receiptB]))).toMatchObject({
      changed: 0,
      notFound: 1,
    });
    // A's receipts into B's group, by B.
    expect(await run(addReceiptsToGroup(other, tripB.id, [receiptA1, receiptB]))).toMatchObject({
      changed: 1,
      notFound: 1,
    });
    // B acting on A's group at all.
    for (const effect of [
      addReceiptsToGroup(other, tripA.id, [receiptB]),
      removeReceiptsFromGroup(other, tripA.id, [receiptA1]),
      updateGroup(other, tripA.id, { name: "pwned" }),
      deleteGroup(other, tripA.id),
      groupsOfReceipt(other, receiptA1),
    ]) {
      expect(await outcome(effect as Effect.Effect<unknown, never, AppServices>)).toMatchObject({
        tag: "NotFound",
      });
    }
    expect((await run(listGroups(other))).map((g) => g.id)).not.toContain(tripA.id);

    const rows = await db((d) =>
      d
        .select({ receiptId: receiptGroupMembers.receiptId })
        .from(receiptGroupMembers)
        .where(eq(receiptGroupMembers.groupId, tripB.id)),
    );
    expect(rows).toEqual([{ receiptId: receiptB }]);
    const [{ value }] = await db((d) =>
      d
        .select({ value: sql<number>`count(*)::int` })
        .from(receiptGroupMembers)
        .where(eq(receiptGroupMembers.receiptId, receiptB)),
    );
    expect(value).toBe(1);

    // Filtering B's history by A's group finds nothing; A's by its own finds both.
    const list = (scope: ReceiptScope, groups: string[]) =>
      run(Effect.flatMap(ReceiptRepo, (r) => r.list(scope, { groups }, { limit: 50, offset: 0 })));
    expect((await list(other, [tripA.id])).total).toBe(0);
    expect((await list(owner, [tripB.id])).total).toBe(0);
    expect((await list(owner, [tripA.id])).total).toBe(2);
  });

  it("filters History by any of several groups, and exports group names", async () => {
    const accounting = (await run(listGroups(owner))).find((g) => g.name === "Accounting")!;
    const trip = (await run(listGroups(owner))).find((g) => g.name === "Berlin trip")!;
    const solo = await seedReceipt(owner, "Not grouped");
    await run(addReceiptsToGroup(owner, accounting.id, [receiptA1]));

    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f));
    const onlyAccounting = await repo((r) =>
      r.list(owner, { groups: [accounting.id] }, { limit: 50, offset: 0 }),
    );
    expect(onlyAccounting.rows.map((row) => row.id)).toEqual([receiptA1]);
    const either = await repo((r) =>
      r.list(owner, { groups: [accounting.id, trip.id] }, { limit: 50, offset: 0 }),
    );
    expect(either.total).toBe(2);
    expect(either.rows.map((row) => row.id)).not.toContain(solo);

    const exported = await repo((r) => r.exportRows(owner, { groups: [accounting.id] }, 10));
    expect(exported).toHaveLength(1);
    expect(exported[0]!.groups).toEqual(["Accounting", "Berlin trip"]);
    const all = await repo((r) => r.exportRows(owner, {}, 10));
    expect(all.find((row) => row.id === solo)?.groups).toEqual([]);
  });

  it("permissions: members manage receipts in any group but rename or delete only their own", async () => {
    const ownersGroup = (await run(listGroups(owner))).find((g) => g.name === "Berlin trip")!;
    expect((await run(listGroups(memberA))).find((g) => g.id === ownersGroup.id)?.canManage).toBe(
      false,
    );
    expect(await outcome(updateGroup(memberA, ownersGroup.id, { color: "red" }))).toMatchObject({
      tag: "Forbidden",
    });
    expect(await outcome(deleteGroup(memberA, ownersGroup.id))).toMatchObject({ tag: "Forbidden" });

    const mine = await create(memberA, "Member's group");
    expect(mine.canManage).toBe(true);
    expect((await run(updateGroup(memberA, mine.id, { color: "pink" }))).color).toBe("pink");
    // Admins and owners manage anyone's group.
    expect((await run(updateGroup(adminA, mine.id, { name: "Renamed by admin" }))).name).toBe(
      "Renamed by admin",
    );
    expect((await run(updateGroup(owner, mine.id, { color: "teal" }))).color).toBe("teal");
    expect(await outcome(deleteGroup(adminA, mine.id))).toEqual({ tag: "ok" });

    // A group whose creator was deleted: only owners and admins.
    const orphan = await create(memberA, "Orphan");
    await db((d) =>
      d.update(receiptGroups).set({ createdBy: null }).where(eq(receiptGroups.id, orphan.id)),
    );
    expect(await outcome(updateGroup(memberA, orphan.id, { color: "red" }))).toMatchObject({
      tag: "Forbidden",
    });
    expect(await outcome(deleteGroup(owner, orphan.id))).toEqual({ tag: "ok" });
    // No role at all fails closed.
    const noRole = { organizationId: owner.organizationId, userId: `${tag}-nobody` };
    expect(await outcome(deleteGroup(noRole, ownersGroup.id))).toMatchObject({ tag: "Forbidden" });
  });

  it(`a receipt is in at most ${MAX_GROUPS_PER_RECEIPT} groups; a bulk add skips full ones`, async () => {
    const target = await seedReceipt(owner, "Busy receipt");
    const spare = await seedReceipt(owner, "Spare receipt");
    const ids: string[] = [];
    for (let i = 0; i < MAX_GROUPS_PER_RECEIPT + 1; i++) {
      ids.push((await create(owner, `Limit ${i}`)).id);
    }
    for (const id of ids.slice(0, MAX_GROUPS_PER_RECEIPT)) {
      await run(addReceiptsToGroup(owner, id, [target]));
    }
    expect(await run(groupsOfReceipt(owner, target))).toHaveLength(MAX_GROUPS_PER_RECEIPT);
    expect(await run(addReceiptsToGroup(owner, ids.at(-1)!, [target, spare]))).toEqual({
      changed: 1,
      unchanged: 0,
      atLimit: 1,
      notFound: 0,
    });
    for (const id of ids) await run(deleteGroup(owner, id));
  });

  it(`a workspace has at most ${MAX_GROUPS_PER_WORKSPACE} groups`, async () => {
    const existing = (await run(listGroups(owner))).length;
    await db((d) =>
      d.insert(receiptGroups).values(
        Array.from({ length: MAX_GROUPS_PER_WORKSPACE - existing - 1 }, (_, i) => ({
          organizationId: owner.organizationId,
          name: `Bulk ${i}`,
          color: "green",
          createdBy: owner.userId,
        })),
      ),
    );
    await create(owner, "The hundredth");
    expect(
      await outcome(createGroup(owner, { name: "One too many", color: "green" })),
    ).toMatchObject({
      tag: "Conflict",
      message: expect.stringContaining(`${MAX_GROUPS_PER_WORKSPACE}`),
    });
    // Another workspace is unaffected.
    expect((await create(other, "Still fine")).name).toBe("Still fine");
    await db((d) => d.delete(receiptGroups).where(sql`${receiptGroups.name} like 'Bulk %'`));
  });

  it("deleting a receipt drops its memberships; deleting a group keeps its receipts", async () => {
    const trip = (await run(listGroups(owner))).find((g) => g.name === "Berlin trip")!;
    const doomed = await seedReceipt(owner, "Deleted later");
    await run(addReceiptsToGroup(owner, trip.id, [doomed]));
    expect((await run(listGroups(owner))).find((g) => g.id === trip.id)?.receiptCount).toBe(3);

    await db((d) => d.delete(receipts).where(eq(receipts.id, doomed)));
    expect((await run(listGroups(owner))).find((g) => g.id === trip.id)?.receiptCount).toBe(2);

    await run(deleteGroup(owner, trip.id));
    const left = await db((d) =>
      d
        .select({ id: receipts.id })
        .from(receipts)
        .where(sql`${receipts.id} in (${receiptA1}, ${receiptA2})`),
    );
    expect(left).toHaveLength(2);
    expect(await run(groupsOfReceipt(owner, receiptA2))).toEqual([]);
  });

  it("concurrent creates of one name make exactly one group", async () => {
    const racer = await createUser("racer-name");
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        outcome(createGroup(racer, { name: i % 2 ? "Same Name" : "same name", color: "red" })),
      ),
    );
    expect(results.filter((r) => r.tag === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.tag === "Conflict")).toHaveLength(5);
    expect(await run(listGroups(racer))).toHaveLength(1);
  });

  it("concurrent creates at the workspace limit never pass it", async () => {
    const racer = await createUser("racer-limit");
    await db((d) =>
      d.insert(receiptGroups).values(
        Array.from({ length: MAX_GROUPS_PER_WORKSPACE - 1 }, (_, i) => ({
          organizationId: racer.organizationId,
          name: `Filler ${i}`,
          color: "green",
          createdBy: racer.userId,
        })),
      ),
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        outcome(createGroup(racer, { name: `Racer ${i}`, color: "blue" })),
      ),
    );
    expect(results.filter((r) => r.tag === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.tag === "Conflict")).toHaveLength(4);
    expect(await run(listGroups(racer))).toHaveLength(MAX_GROUPS_PER_WORKSPACE);
  });

  it("setReceiptGroup adds, removes, reads back, refuses the 21st group and foreign receipts", async () => {
    const lone = await seedReceipt(owner, "Single add");
    const g = await create(owner, "Single add group");
    const added = await run(setReceiptGroup(owner, lone, g.id, "add"));
    expect(added.map((x) => x.id)).toEqual([g.id]);
    // Adding again is a no-op, not an error.
    expect(await run(setReceiptGroup(owner, lone, g.id, "add"))).toHaveLength(1);
    expect(await run(setReceiptGroup(owner, lone, g.id, "remove"))).toEqual([]);

    expect(await outcome(setReceiptGroup(owner, receiptB, g.id, "add"))).toMatchObject({
      tag: "NotFound",
    });
    expect(await outcome(setReceiptGroup(owner, lone, "not-a-uuid", "add"))).toMatchObject({
      tag: "InvalidInput",
    });

    const ids: string[] = [];
    for (let i = 0; i < MAX_GROUPS_PER_RECEIPT; i++) {
      const x = await create(owner, `Full ${i}`);
      ids.push(x.id);
      await run(setReceiptGroup(owner, lone, x.id, "add"));
    }
    expect(await outcome(setReceiptGroup(owner, lone, g.id, "add"))).toMatchObject({
      tag: "Conflict",
    });
    expect(await run(groupsOfReceipt(owner, lone))).toHaveLength(MAX_GROUPS_PER_RECEIPT);
    for (const id of [g.id, ...ids]) await run(deleteGroup(owner, id));
  });

  it("a foreign key violation from a receipt deleted between check and insert is NotFound", async () => {
    // Postgres reports the race as 23503; provoke the real error and map it.
    const g = await create(owner, "Vanishing group");
    const ghost = crypto.randomUUID();
    const error = await db((d) =>
      d
        .insert(receiptGroupMembers)
        .values({ groupId: g.id, receiptId: ghost, addedBy: owner.userId })
        .then(
          () => null,
          (e: unknown) => e,
        ),
    );
    expect(() => notFoundOnForeignKey(error)).toThrowError(
      expect.objectContaining({ _tag: "NotFound" }),
    );
    expect(() => notFoundOnForeignKey(new Error("other"))).toThrowError("other");
    // A receipt that is already gone is NotFound through the whole call as well.
    const doomed = await seedReceipt(owner, "Vanishing");
    await db((d) => d.delete(receipts).where(eq(receipts.id, doomed)));
    expect(await outcome(setReceiptGroup(owner, doomed, g.id, "add"))).toMatchObject({
      tag: "NotFound",
    });
    await run(deleteGroup(owner, g.id));
  });

  it("export ignores a membership row that points at another workspace's group", async () => {
    const mine = await seedReceipt(owner, "Foreign link");
    const foreign = await create(other, "Foreign secret");
    await db((d) =>
      d.insert(receiptGroupMembers).values({
        groupId: foreign.id,
        receiptId: mine,
        addedBy: other.userId,
      }),
    );
    const rows = await run(Effect.flatMap(ReceiptRepo, (r) => r.exportRows(owner, {}, 500)));
    expect(rows.find((row) => row.id === mine)?.groups).toEqual([]);
    await db((d) => d.delete(receiptGroupMembers).where(eq(receiptGroupMembers.receiptId, mine)));
  });

  it("removing a member keeps their groups and clears the creator link in that workspace only", async () => {
    const leaver = await joinAs(owner, "leaver", "member");
    const elsewhere = await createUser("leaver-home");
    const kept = await create(leaver, "Leaver group");
    // The same person also created a group in a workspace they stay in.
    const [stays] = await db((d) =>
      d
        .insert(receiptGroups)
        .values({
          organizationId: elsewhere.organizationId,
          name: "Stays",
          color: "green",
          createdBy: leaver.userId,
        })
        .returning({ id: receiptGroups.id }),
    );
    await run(
      removeMember(owner.organizationId, `${leaver.userId}-m`, {
        actor: { id: owner.userId, email: "owner@example.com" },
      }),
    );
    const groups = await run(listGroups(owner));
    expect(groups.find((x) => x.id === kept.id)).toMatchObject({ createdBy: null });
    const [other_] = await db((d) =>
      d
        .select({ createdBy: receiptGroups.createdBy })
        .from(receiptGroups)
        .where(eq(receiptGroups.id, stays!.id)),
    );
    expect(other_?.createdBy).toBe(leaver.userId);
    // Owners and admins can still manage the orphaned group; plain members can't.
    expect(groups.find((x) => x.id === kept.id)?.canManage).toBe(true);
    expect((await run(listGroups(memberA))).find((x) => x.id === kept.id)?.canManage).toBe(false);
  });

  it("releaseMemberGroups (the Better Auth removal hook) clears the creator link in that workspace only", async () => {
    const gone = await joinAs(owner, "gone", "member");
    const home = await createUser("gone-home");
    const mine = await create(gone, "Gone group");
    const [stays] = await db((d) =>
      d
        .insert(receiptGroups)
        .values({
          organizationId: home.organizationId,
          name: "Gone stays",
          color: "green",
          createdBy: gone.userId,
        })
        .returning({ id: receiptGroups.id }),
    );
    expect(await run(releaseMemberGroups(owner.organizationId, gone.userId))).toBe(1);
    expect((await run(listGroups(owner))).find((x) => x.id === mine.id)?.createdBy).toBeNull();
    const [row] = await db((d) =>
      d
        .select({ c: receiptGroups.createdBy })
        .from(receiptGroups)
        .where(eq(receiptGroups.id, stays!.id)),
    );
    expect(row?.c).toBe(gone.userId);
    // Running it again changes nothing.
    expect(await run(releaseMemberGroups(owner.organizationId, gone.userId))).toBe(0);
  });
});
