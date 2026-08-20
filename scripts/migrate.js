/**
 * Apply sql/schema.sql using DATABASE_URL (Postgres connection string from Supabase).
 * If DATABASE_URL is missing, prints instructions to run SQL in the Supabase SQL Editor.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function main() {
  const schemaPath = path.join(__dirname, '../sql/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL is not set.');
    console.log('Open Supabase → SQL Editor and paste the contents of sql/schema.sql');
    console.log('Or set DATABASE_URL=postgresql://postgres:...@db.xxx.supabase.co:5432/postgres');
    console.log(`Schema file: ${schemaPath}`);
    process.exit(0);
  }

  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('Connecting to Postgres...');
  await client.connect();
  try {
    console.log('Applying schema.sql ...');
    await client.query(sql);
    console.log('✅ Migration complete');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
