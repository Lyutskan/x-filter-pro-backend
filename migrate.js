const mysql = require('mysql2/promise');
async function run() {
  console.log('[Migration] Connecting to database...');
  const c = await mysql.createConnection(process.env.DATABASE_URL);
  const queries = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS authProvider ENUM('email','google') NOT NULL DEFAULT 'email'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS passwordHash VARCHAR(512) NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS emailVerified BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE users MODIFY COLUMN openId VARCHAR(64) NULL"
  ];
  for (const q of queries) {
    try { await c.execute(q); console.log('[Migration] OK:', q.slice(0, 60)); }
    catch (e) { console.log('[Migration] SKIP:', e.message.slice(0, 80)); }
  }
  await c.end();
  console.log('[Migration] Done!');
}
run();
