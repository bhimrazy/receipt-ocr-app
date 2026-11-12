import { defineConfig } from "drizzle-kit";

// DDL runs over a session connection (DIRECT_URL); DATABASE_URL covers local and simple setups.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
const ca = process.env.DATABASE_SSL_CA?.trim().replaceAll("\\n", "\n");

// With a URL, drizzle-kit hands it to pg, which reads `sslmode=require` as verify-full against public
// CAs. A provider with its own CA (Supabase) needs that CA, which drizzle-kit only takes with fields.
function credentials() {
  if (!ca || !url) return { url };
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl: { ca, rejectUnauthorized: true },
  };
}

export default defineConfig({
  schema: "../../packages/db/src/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: credentials(),
});
