/**
 * Startup migrations
 * ──────────────────
 * Idempotent SQL that runs every server boot. Each statement uses
 * `IF NOT EXISTS` (or equivalent) so it's safe to re-run.
 *
 * Why not drizzle-kit? Because the Railway-hosted MySQL has no SQL console
 * we can use, and adding a separate migration runner to the deploy pipeline
 * is overkill for our setup. Inline migrations let us ship schema changes
 * with a regular `git push`.
 *
 * Add new migrations to the bottom of the array. Don't reorder or delete.
 */

import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

type Db = ReturnType<typeof drizzle>;

interface Migration {
  name: string;
  statements: string[];
}

const MIGRATIONS: Migration[] = [
  {
    name: "0003_password_reset_tokens",
    statements: [
      `CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INT AUTO_INCREMENT NOT NULL,
        userId INT NOT NULL,
        token VARCHAR(128) NOT NULL,
        expiresAt TIMESTAMP NOT NULL,
        usedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY password_reset_tokens_token_unique (token),
        KEY password_reset_tokens_userId_idx (userId)
      )`,
    ],
  },
  // Future migrations: append here. Never edit existing entries.
];

/**
 * Run all migrations. Each statement is best-effort; we log failures but
 * don't crash the server, because:
 *   - Most failures are "already exists" or "duplicate key" — benign
 *   - Hard-failing on migration would brick the entire app for a small issue
 *   - Real schema corruption is detected later via runtime queries anyway
 */
export async function runStartupMigrations(db: Db): Promise<void> {
  console.log("[Migrations] Running startup migrations…");
  let okCount = 0;
  let skipCount = 0;

  for (const migration of MIGRATIONS) {
    for (const stmt of migration.statements) {
      try {
        await db.execute(sql.raw(stmt));
        okCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Treat common "already exists" errors as no-op
        if (
          msg.includes("already exists") ||
          msg.includes("Duplicate column") ||
          msg.includes("Duplicate key")
        ) {
          skipCount++;
        } else {
          console.error(`[Migrations] ${migration.name} statement failed:`, msg);
        }
      }
    }
  }

  console.log(`[Migrations] Done. ${okCount} applied, ${skipCount} skipped (already present).`);
}
