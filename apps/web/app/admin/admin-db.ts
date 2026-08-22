import { createDb, type DbClient } from "@receipt-ocr/db";
import { authEnv } from "@/lib/env";

/**
 * Read-only database access for the admin area. The admin plugin doesn't expose
 * organization listing, so those views query the schema directly. Server-only:
 * this module is imported exclusively by admin server components/actions, which
 * already gate on requireAdmin().
 *
 * `createDb` memoizes per connection string, so this hands back the same pool
 * the rest of the app uses.
 */
export function adminDb(): DbClient {
  if (!authEnv.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  return createDb(authEnv.databaseUrl);
}
