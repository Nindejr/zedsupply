// Deno-only wiring for the handlers: the database connection, sign-in lookup and fetch.
// Supabase provides SUPABASE_DB_URL, SUPABASE_URL and SUPABASE_ANON_KEY to every function.
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import type { Deps } from './handlers.ts';

const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 2, prepare: false });
const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });

export const deps: Deps = {
  env: name => Deno.env.get(name),
  async userIdForToken(token) {
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return null;
    const rows = await db`SELECT id FROM users WHERE auth_id = ${data.user.id}`;
    return rows.length ? Number(rows[0].id) : null;
  },
  sql: (text, params) => db.unsafe(text, params as never[]) as unknown as Promise<Record<string, unknown>[]>,
  fetch: (input, init) => fetch(input, init)
};
