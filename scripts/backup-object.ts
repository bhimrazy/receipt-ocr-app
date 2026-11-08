// Puts or gets one object on the backup bucket for scripts/db-backup.sh, through Bun's built-in S3 client
// (R2, S3 or RustFS), so the backup job installs no packages.
//
//   bun scripts/backup-object.ts put <key> <file>
//   bun scripts/backup-object.ts get <key> <file>

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`backup-object: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

const [command, key, file] = process.argv.slice(2);
if (!key || !file || (command !== "put" && command !== "get")) {
  console.error("usage: bun scripts/backup-object.ts put|get <key> <file>");
  process.exit(2);
}

const client = new Bun.S3Client({
  endpoint: env("BACKUP_R2_ENDPOINT"),
  bucket: env("BACKUP_R2_BUCKET"),
  accessKeyId: env("BACKUP_R2_ACCESS_KEY_ID"),
  secretAccessKey: env("BACKUP_R2_SECRET_ACCESS_KEY"),
  region: process.env.BACKUP_R2_REGION || "auto",
});

try {
  if (command === "put") {
    const type = key.endsWith(".json") ? "application/json" : "application/octet-stream";
    await client.write(key, Bun.file(file), { type });
  } else {
    await Bun.write(file, client.file(key));
  }
} catch (error) {
  // The S3 error's name and code only: messages can carry the endpoint.
  const { name, code } = (error ?? {}) as { name?: string; code?: string };
  console.error(
    `backup-object: ${command} ${key} failed (${name ?? "Error"}${code ? `, ${code}` : ""})`,
  );
  process.exit(1);
}
