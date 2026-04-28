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
  {
    name: "0004_email_verification_tokens",
    statements: [
      `CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id INT AUTO_INCREMENT NOT NULL,
        userId INT NOT NULL,
        token VARCHAR(128) NOT NULL,
        expiresAt TIMESTAMP NOT NULL,
        usedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY email_verification_tokens_token_unique (token),
        KEY email_verification_tokens_userId_idx (userId)
      )`,
      // Mark all existing users as verified (they signed up before email verification was a thing)
      `UPDATE users SET emailVerified = true WHERE emailVerified IS NULL OR emailVerified = false`,
    ],
  },
  {
    name: "0005_auth_sessions",
    statements: [
      `CREATE TABLE IF NOT EXISTS auth_sessions (
        id INT AUTO_INCREMENT NOT NULL,
        userId INT NOT NULL,
        sid VARCHAR(128) NOT NULL,
        deviceLabel VARCHAR(200) NULL,
        ip VARCHAR(64) NULL,
        userAgent VARCHAR(500) NULL,
        lastActiveAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expiresAt TIMESTAMP NOT NULL,
        revokedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY auth_sessions_sid_unique (sid),
        KEY auth_sessions_userId_idx (userId),
        KEY auth_sessions_expiresAt_idx (expiresAt)
      )`,
    ],
  },
  {
    name: "0006_grant_admin_role",
    statements: [
      // Grant admin role to the project owner so the /admin dashboard works.
      // Idempotent: re-running just keeps the role at admin.
      `UPDATE users SET role = 'admin' WHERE email = 'lyutskangradinarov@gmail.com'`,
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
