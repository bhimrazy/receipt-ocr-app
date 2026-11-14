/**
 * Admin deletion paths against real Postgres and S3. Skipped unless
 * INTEGRATION=1 (see receipts.int.test.ts for the setup).
 */
import {
  adminAuditLog,
  and,
  appSettings,
  eq,
  inArray,
  invitation,
  jobs,
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
} from "../src/admin";
import { countOtherAdmins } from "../src/admin-queries";
import { DEFAULT_PLANS } from "../src/plans";
import { Settings } from "../src/settings";
import { AppLayer, type AppServices } from "../src/index";
import { JOB_REGISTRY, STORAGE_DELETE, tick } from "../src/jobs";
import { ingestUpload, purgeReceiptFiles } from "../src/pipeline";
import { MAX_BULK_DELETE } from "../src/repository";
import { Db, Storage } from "../src/services";
import { ensurePersonalWorkspace } from "../src/workspace";

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
  run(
    ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits: { perMinute: 1e6, perDay: 1e6 } }),
  ).then((r) => r.receipt);

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

const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const deletedWorkspaces = new Set<string>();

const deleteJobs = async (organizationId: string) => {
  deletedWorkspaces.add(organizationId);
  const rows = await db((d) =>
    d
      .select({ id: jobs.id, payload: jobs.payload })
      .from(jobs)
      .where(and(eq(jobs.kind, STORAGE_DELETE), eq(jobs.organizationId, organizationId))),
  );
  return rows.map((row) => ({ id: row.id, keys: (row.payload as { keys: string[] }).keys }));
};

const runJobs = async (ids: string[]) => {
  const stats = await run(
    tick({
      worker: `${tag}-worker`,
      registry: JOB_REGISTRY,
      budgetMs: 30_000,
      ids,
      waitForRetries: false,
    }),
  );
  expect(stats.runs.map((r) => r.outcome)).toEqual(ids.map(() => "succeeded"));
};

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
        if (deletedWorkspaces.size > 0) {
          await d.delete(jobs).where(inArray(jobs.organizationId, [...deletedWorkspaces]));
        }
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
    expect(result).toEqual({ workspacesDeleted: 1, files: 1 });
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use((d) => d.delete(user).where(sql`${user.id} = ${carol.userId}`)),
      ),
    );

    const queued = await deleteJobs(carol.organizationId);
    expect(queued.map((job) => job.keys)).toEqual([[own.imageObjectKey]]);
    expect(await objectExists(own.imageObjectKey!)).toBe(true);
    await runJobs(queued.map((job) => job.id));
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

  it("deleting a workspace removes its rows, writes the audit row and queues its files' deletion", async () => {
    const gina = await createUser("gina");
    const receipt = await upload(gina);
    const { files } = await run(deleteWorkspace(gina.organizationId, auditor));
    expect(files).toBe(1);
    expect(await workspaceExists(gina.organizationId)).toBe(false);
    expect(await auditRows("workspace.delete", gina.organizationId)).toHaveLength(1);

    const queued = await deleteJobs(gina.organizationId);
    expect(queued.map((job) => job.keys)).toEqual([[receipt.imageObjectKey]]);
    expect(await objectExists(receipt.imageObjectKey!)).toBe(true);
    await runJobs(queued.map((job) => job.id));
    expect(await objectExists(receipt.imageObjectKey!)).toBe(false);
  });

  it("keeps the files and queues nothing when the row delete fails", async () => {
    const nora = await createUser("nora");
    const receipt = await upload(nora);
    const fn = `adm_fail_${Date.now()}`;
    await db(async (d) => {
      await d.execute(
        sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
          begin if old.id = '${nora.organizationId}' then raise exception 'blocked'; end if;
          return old; end $$`),
      );
      await d.execute(
        sql.raw(
          `create trigger ${fn} before delete on organization for each row execute function ${fn}()`,
        ),
      );
    });
    try {
      expect(Exit.isFailure(await runExit(deleteWorkspace(nora.organizationId, auditor)))).toBe(
        true,
      );
      expect(Exit.isFailure(await runExit(prepareUserDeletion(nora.userId)))).toBe(true);
    } finally {
      await db(async (d) => {
        await d.execute(sql.raw(`drop trigger if exists ${fn} on organization`));
        await d.execute(sql.raw(`drop function if exists ${fn}()`));
      });
    }
    expect(await workspaceExists(nora.organizationId)).toBe(true);
    expect(await deleteJobs(nora.organizationId)).toEqual([]);
    expect(await objectExists(receipt.imageObjectKey!)).toBe(true);
    expect(await auditRows("workspace.delete", nora.organizationId)).toHaveLength(0);
  });

  it("splits a large workspace's files into storage.delete jobs of at most MAX_BULK_DELETE keys", async () => {
    const olga = await createUser("olga");
    await db((d) =>
      d.insert(receipts).values(
        Array.from({ length: MAX_BULK_DELETE + 1 }, (_, i) => ({
          organizationId: olga.organizationId,
          userId: olga.userId,
          status: "failed" as const,
          fileName: `${i}.jpg`,
          imageObjectKey: `${tag}/olga/${i}.jpg`,
        })),
      ),
    );
    expect(await run(prepareUserDeletion(olga.userId))).toEqual({
      workspacesDeleted: 1,
      files: MAX_BULK_DELETE + 1,
    });
    const sizes = (await deleteJobs(olga.organizationId)).map((job) => job.keys.length).sort();
    expect(sizes).toEqual([1, MAX_BULK_DELETE]);
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
      const first = { free: { ...DEFAULT_PLANS.free, receiptsPerDay: 21 }, pro };
      const second = { free: { ...DEFAULT_PLANS.free, receiptsPerDay: 22 }, pro };
      await run(Effect.flatMap(Settings, (s) => s.plans)); // warm the cache
      await run(Effect.flatMap(Settings, (s) => s.save("plans", first, auditor)));
      // Another process writes behind this one's cache.
      await run(
        Effect.flatMap(Db, ({ use }) =>
          use((d) =>
            d
              .update(appSettings)
              .set({ value: { ...first, free: { ...first.free, receiptsPerDay: 23 } } })
              .where(eq(appSettings.key, "plans")),
          ),
        ),
      );
      await run(Effect.flatMap(Settings, (s) => s.plans)); // re-cache the first save
      const { previous } = await run(
        Effect.flatMap(Settings, (s) => s.save("plans", second, auditor)),
      );
      expect(previous.free.receiptsPerDay).toBe(23);
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

describe.skipIf(!enabled)("last-admin guard query", () => {
  it("counts other unbanned admins, including multi-role values", async () => {
    const subject = await createUser("la-subject");
    const base = await run(countOtherAdmins(subject.userId));
    const setRole = (id: string, role: string, banned = false) =>
      run(
        Effect.flatMap(Db, ({ use }) =>
          use((d) => d.update(user).set({ role, banned }).where(eq(user.id, id))),
        ),
      );
    const other = await createUser("la-other");
    const banned = await createUser("la-banned");
    const plain = await createUser("la-plain");
    await setRole(subject.userId, "admin");
    await setRole(other.userId, "user,admin");
    await setRole(banned.userId, "admin", true);
    await setRole(plain.userId, "user");
    expect(await run(countOtherAdmins(subject.userId))).toBe(base + 1);
    await setRole(other.userId, "user");
    expect(await run(countOtherAdmins(subject.userId))).toBe(base);
  });
});
