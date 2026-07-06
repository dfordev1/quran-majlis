// Adds multi-room + multi-user schema for the cloud majlis.
// Run: "C:\Program Files\nodejs\node.exe" setupdb.js  (borrows HospitalSim's pg module)
const { Client } = require(require('path').join('C:', 'Users', 'Dev', 'Documents', 'HospitalSim', 'node_tools', 'node_modules', 'pg'));

const SQL = `
create table if not exists majlis_rooms (
  id bigint generated always as identity primary key,
  at timestamptz default now(),
  topic text not null,
  verse jsonb,
  created_by text,
  open boolean default true
);
alter table majlis_messages add column if not exists room_id bigint;
alter table majlis_messages add column if not exists color text;
alter table majlis_messages add column if not exists kind text;
create index if not exists majlis_messages_room on majlis_messages (room_id, id);
alter table majlis_rooms enable row level security;
drop policy if exists majlis_rooms_all on majlis_rooms;
create policy majlis_rooms_all on majlis_rooms for all using (true) with check (true);
`;

(async () => {
  const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 6543,
    user: 'postgres.ssknrqfaludyprjncdbx', database: 'postgres', password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    await c.query(SQL);
    console.log('OK — cloud schema ready');
  } catch (e) { console.log('FAILED:', e.message); process.exitCode = 1; }
  finally { try { await c.end(); } catch {} }
})();
