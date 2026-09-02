import "dotenv/config";
import { Client } from "pg";
async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await c.connect();
  const r = await c.query(`
    select tc.table_name as child, kcu.column_name as col,
           ccu.table_name as parent, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
      join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
      join information_schema.referential_constraints rc on tc.constraint_name = rc.constraint_name
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema='public'
     order by ccu.table_name, tc.table_name`);
  console.table(r.rows);
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
