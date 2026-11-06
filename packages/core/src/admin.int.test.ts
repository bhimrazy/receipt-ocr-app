/**
 * Admin deletion paths against real Postgres and S3. Skipped unless
 * INTEGRATION=1 (see receipts.int.test.ts for the setup).
 */
import {
  adminAuditLog,
  appSettings,
  eq,
  invitation,
  member,
  organization,
  receipts,
  sql,
  user,
} from "@receipt-ocr/db";
import { Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelInvitation,
  deleteWorkspace,
  prepareUserDeletion,
  removeMember,
  setMemberRole,
  setUserPlan,
} from "./admin";
import { DEFAULT_PLANS } from "./plans";
import { Settings } from "./settings";
import { AppLayer, type AppServices } from "./index";
import { ingestUpload, purgeReceiptFiles } from "./pipeline";
import { Db, Storage } from "./services";
import { ensurePersonalWorkspace } from "./workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const runExit = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromiseExit(effect);

const tag = `adm-${Date.now()}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);

async function createUser(name: string) {
  const id = `${tag}-${name}`;
  const email = `${id}@example.com`;
  await run(
    Effect.flatMap(Db, ({ use }) =>
      use((d) => d.insert(user).values({ id, name, email, emailVerified: true })),
    ),
  );
  const organizationId = await run(ensurePersonalWorkspace({ id, name, email }));
  if (!organizationId) throw new Error("no workspace");
  return { userId: id, organizationId, role: "owner" };
}

async function join(userId: string, organizationId: string, role = "member") {
  const id = `${tag}-m-${userId}-${organizationId}`;
  await run(
    Effect.flatMap(Db, ({ use }) =>
      use((d) =>
        d.insert(member).values({
          id,
          userId,
          organizationId,
          role,
          createdAt: new Date(),
        }),
      ),
    ),
  );
  return id;
}

const upload = (scope: { userId: string; organizationId: string; role: string }) =>
  run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG })).then((r) => r.receipt);

const objectExists = async (key: string) =>
  Exit.isSuccess(await runExit(Effect.flatMap(Storage, (s) => s.get(key))));

const workspaceExists = (organizationId: string) =>
  run(
    Effect.flatMap(Db, ({ use }) =>
      use((d) =>
        d
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, organizationId)),
      ),
    ),
  ).then((rows) => rows.length === 1);

const auditRows = (action: string, targetId: string) =>
  run(
    Effect.flatMap(Db, ({ use }) =>
      use((d) =>
        d
          .select()
          .from(adminAuditLog)
          .where(
            sql`${adminAuditLog.action} = ${action} and ${adminAuditLog.targetId} = ${targetId}`,
          ),
      ),
    ),
  );

/** An admin to attribute changes to: actor_id must reference a real user. */
let auditor: { actor: { id: string; email: string }; ip: string };
beforeAll(async () => {
  if (!enabled) return;
  const admin = await createUser("auditor");
  auditor = {
    actor: { id: admin.userId, email: `${admin.userId}@example.com` },
    ip: "203.0.113.9",
  };
});

afterAll(async () => {
  if (!enabled) return;
  await run(
    Effect.flatMap(Db, ({ use }) =>
      use(async (d) => {
        const orgs = await d
          .select({ id: organization.id })
          .from(organization)
          .where(sql`${organization.slug} like ${`${tag}%`}`);
        for (const org of orgs) {
          await runtime.runPromise(purgeReceiptFiles({ organizationId: org.id }));
        }
        await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
        await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
      }),
    ),
  );
  await runtime.dispose();
});

describe.skipIf(!enabled)("admin deletion against Postgres + S3", () => {
  it("P0-2: deleting a user removes their solo workspace and its files, but keeps receipts they added to a shared one", async () => {
    const carol = await createUser("carol");
    const dave = await createUser("dave");
    await join(carol.userId, dave.organizationId);
    const own = await upload(carol);
    const shared = await upload({ ...carol, organizationId: dave.organizationId, role: "member" });

    const result = await run(prepareUserDeletion(carol.userId));
    expect(result.workspacesDeleted).toBe(1);
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use((d) => d.delete(user).where(sql`${user.id} = ${carol.userId}`)),
      ),
    );

    expect(await objectExists(own.imageObjectKey!)).toBe(false);
    expect(await objectExists(shared.imageObjectKey!)).toBe(true);
    const rows = await run(
      Effect.flatMap(Db, ({ use }) =>
        use((d) =>
          d
            .select({ id: receipts.id, userId: receipts.userId })
            .from(receipts)
            .where(sql`${receipts.id} in (${own.id}, ${shared.id})`),
        ),
      ),
    );
    expect(rows).toEqual([{ id: shared.id, userId: null }]);
  });

  it("refuses while the user is the only owner of a workspace with other members", async () => {
    const erin = await createUser("erin");
    const frank = await createUser("frank");
    await join(frank.userId, erin.organizationId);
    const exit = await runExit(prepareUserDeletion(erin.userId));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("Conflict");
  });

  it("deletes a user who co-owns a shared workspace with another owner, and keeps that workspace", async () => {
    const hana = await createUser("hana");
    const ivan = await createUser("ivan");
    await join(hana.userId, ivan.organizationId, "owner");
    const result = await run(prepareUserDeletion(hana.userId));
    expect(result.workspacesDeleted).toBe(1);
    expect(await workspaceExists(ivan.organizationId)).toBe(true);
    expect(await workspaceExists(hana.organizationId)).toBe(false);
  });

  it("deleting a workspace removes its rows, writes the audit row, then deletes its files", async () => {
    const gina = await createUser("gina");
    const receipt = await upload(gina);
    const { files } = await run(deleteWorkspace(gina.organizationId, auditor));
    expect(files).toBe(1);
    expect(await workspaceExists(gina.organizationId)).toBe(false);
    expect(await objectExists(receipt.imageObjectKey!)).toBe(false);
    expect(await auditRows("workspace.delete", gina.organizationId)).toHaveLength(1);
  });
});

describe.skipIf(!enabled)("admin workspace changes against Postgres", () => {
  const memberRole = (memberId: string) =>
    run(
      Effect.flatMap(Db, ({ use }) =>
        use((d) => d.select({ role: member.role }).from(member).where(eq(member.id, memberId))),
      ),
    ).then((rows) => rows[0]?.role);

  /** The membership `ensurePersonalWorkspace` created for the workspace's owner. */
  const ownerMemberId = (owner: { userId: string; organizationId: string }) =>
    run(
      Effect.flatMap(Db, ({ use }) =>
        use((d) =>
          d
            .select({ id: member.id })
            .from(member)
            .where(
              sql`${member.organizationId} = ${owner.organizationId} and ${member.userId} = ${owner.userId}`,
            ),
        ),
      ),
    ).then((rows) => rows[0]!.id);

  it("refuses to demote or remove the only owner, and writes no audit row", async () => {
    const jack = await createUser("jack");
    await join((await createUser("kim")).userId, jack.organizationId);
    const owner = await ownerMemberId(jack);

    const demote = await runExit(setMemberRole(jack.organizationId, owner, "member", auditor));
    expect(Exit.isFailure(demote) && JSON.stringify(demote.cause)).toContain("only owner");
    const remove = await runExit(removeMember(jack.organizationId, owner, auditor));
    expect(Exit.isFailure(remove) && JSON.stringify(remove.cause)).toContain("only owner");

    expect(await memberRole(owner)).toBe("owner");
    expect(await auditRows("workspace.member_role", jack.organizationId)).toHaveLength(0);
    expect(await auditRows("workspace.member_remove", jack.organizationId)).toHaveLength(0);
  });

  it("lets only one of two concurrent demotions of the last two owners through", async () => {
    const lena = await createUser("lena");
    const second = await join((await createUser("milo")).userId, lena.organizationId, "owner");
    const first = await ownerMemberId(lena);
    const results = await Promise.all([
      runExit(setMemberRole(lena.organizationId, first, "member", auditor)),
      runExit(setMemberRole(lena.organizationId, second, "member", auditor)),
    ]);
    expect(results.filter(Exit.isSuccess)).toHaveLength(1);
    const roles = [await memberRole(first), await memberRole(second)];
    expect(roles.filter((r) => r === "owner")).toHaveLength(1);
    expect(await auditRows("workspace.member_role", lena.organizationId)).toHaveLength(1);
  });

  it("changes a role with its audit row, labelled with the member's email", async () => {
    const nora = await createUser("nora");
    const otto = await createUser("otto");
    const memberId = await join(otto.userId, nora.organizationId);
    await run(setMemberRole(nora.organizationId, memberId, "admin", auditor));
    expect(await memberRole(memberId)).toBe("admin");
    const [row] = await auditRows("workspace.member_role", nora.organizationId);
    expect(row?.metadata).toEqual({
      member: `${otto.userId}@example.com`,
      from: "member",
      to: "admin",
    });
    expect(row?.ip).toBe("203.0.113.9");
  });

  it("only cancels an invitation through the workspace it belongs to", async () => {
    const pia = await createUser("pia");
    const quinn = await createUser("quinn");
    const invitationId = `${tag}-inv`;
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use((d) =>
          d.insert(invitation).values({
            id: invitationId,
            organizationId: pia.organizationId,
            email: "guest@example.com",
            role: "member",
            status: "pending",
            expiresAt: new Date(Date.now() + 86_400_000),
            inviterId: pia.userId,
          }),
        ),
      ),
    );
    const status = () =>
      run(
        Effect.flatMap(Db, ({ use }) =>
          use((d) =>
            d
              .select({ status: invitation.status })
              .from(invitation)
              .where(eq(invitation.id, invitationId)),
          ),
        ),
      ).then((rows) => rows[0]?.status);

    const wrong = await runExit(cancelInvitation(quinn.organizationId, invitationId, auditor));
    expect(Exit.isFailure(wrong) && JSON.stringify(wrong.cause)).toContain("NotFound");
    expect(await status()).toBe("pending");

    await run(cancelInvitation(pia.organizationId, invitationId, auditor));
    expect(await status()).toBe("canceled");
    expect(await auditRows("workspace.invitation_cancel", pia.organizationId)).toHaveLength(1);
  });
});

describe.skipIf(!enabled)("admin audit rows commit with the change", () => {
  const planOf = (userId: string) =>
    run(
      Effect.flatMap(Db, ({ use }) =>
        use((d) => d.select({ plan: user.plan }).from(user).where(eq(user.id, userId))),
      ),
    ).then((rows) => rows[0]?.plan);

  it("writes the plan change and its audit row together", async () => {
    const rosa = await createUser("rosa");
    await run(setUserPlan(rosa.userId, "pro", auditor));
    expect(await planOf(rosa.userId)).toBe("pro");
    const [row] = await auditRows("user.plan", rosa.userId);
    expect(row?.metadata).toEqual({ from: "free", to: "pro" });
  });

  it("rolls the change back when the audit row can't be written", async () => {
    const sam = await createUser("sam");
    // actor_id references "user", so an unknown actor makes the audit insert fail.
    const ghost = { actor: { id: `${tag}-ghost`, email: "ghost@example.com" } };
    const exit = await runExit(setUserPlan(sam.userId, "pro", ghost));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("DbError");
    expect(await planOf(sam.userId)).toBe("free");
  });

  it("records the stored settings value as `previous`, not the cached one", async () => {
    const before = await run(
      Effect.flatMap(Db, ({ use }) =>
        use((d) => d.select().from(appSettings).where(eq(appSettings.key, "plans"))),
      ),
    );
    try {
      const pro = { ...DEFAULT_PLANS.pro };
      const first = { free: { ...DEFAULT_PLANS.free, receiptsPerDay: 41 }, pro };
      const second = { free: { ...DEFAULT_PLANS.free, receiptsPerDay: 42 }, pro };
      await run(Effect.flatMap(Settings, (s) => s.plans)); // warm the cache
      await run(Effect.flatMap(Settings, (s) => s.save("plans", first, auditor)));
      // Another process writes behind this one's cache.
      await run(
        Effect.flatMap(Db, ({ use }) =>
          use((d) =>
            d
              .update(appSettings)
              .set({ value: { ...first, free: { ...first.free, receiptsPerDay: 43 } } })
              .where(eq(appSettings.key, "plans")),
          ),
        ),
      );
      await run(Effect.flatMap(Settings, (s) => s.plans)); // re-cache the first save
      const { previous } = await run(
        Effect.flatMap(Settings, (s) => s.save("plans", second, auditor)),
      );
      expect(previous.free.receiptsPerDay).toBe(43);
    } finally {
      await run(
        Effect.flatMap(Db, ({ use }) =>
          use(async (d) => {
            await d.delete(appSettings).where(eq(appSettings.key, "plans"));
            if (before[0]) await d.insert(appSettings).values(before[0]);
          }),
        ),
      );
    }
  });
});
