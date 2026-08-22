import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "../../packages/db/src/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations (DDL) run over the Supabase session pooler (5432) via DIRECT_URL;
    // fall back to DATABASE_URL for local/simple setups.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
