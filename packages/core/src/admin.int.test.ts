/**
 * Admin deletion paths against real Postgres and S3. Skipped unless
 * INTEGRATION=1 (see receipts.int.test.ts for the setup).
 */
import { member, organization, receipts, sql, user } from "@receipt-ocr/db";
import { Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { deleteWorkspace, prepareUserDeletion } from "./admin";
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
  await run(
    Effect.flatMap(Db, ({ use }) =>
      use((d) =>
        d.insert(member).values({
          id: `${tag}-m-${userId}-${organizationId}`,
          userId,
          organizationId,
          role,
          createdAt: new Date(),
        }),
      ),
    ),
  );
}

const upload = (scope: { userId: string; organizationId: string; role: string }) =>
  run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG })).then((r) => r.receipt);

const objectExists = async (key: string) =>
  Exit.isSuccess(await runExit(Effect.flatMap(Storage, (s) => s.get(key))));

describe.skipIf(!enabled)("admin deletion against Postgres + S3", () => {
  afterAll(async () => {
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

  it("deleting a workspace deletes its stored files first", async () => {
    const gina = await createUser("gina");
    const receipt = await upload(gina);
    const { files } = await run(deleteWorkspace(gina.organizationId));
    expect(files).toBe(1);
    expect(await objectExists(receipt.imageObjectKey!)).toBe(false);
  });
});
