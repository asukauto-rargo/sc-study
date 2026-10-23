import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const REPO_DIR = dirname(TOOLS_DIR);

/** tools/.env をごく素朴に読む（依存を増やさないため） */
function loadEnv() {
  try {
    const raw = readFileSync(resolve(TOOLS_DIR, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* .env が無くても環境変数で渡せる */
  }
}

export async function connect() {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.SC_EMAIL;
  const password = process.env.SC_PASSWORD;

  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY が未設定です（tools/.env）');
  if (!email || !password) throw new Error('SC_EMAIL / SC_PASSWORD が未設定です（tools/.env）');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`ログインに失敗しました: ${error.message}`);
  console.log(`✓ ${email} としてログインしました`);
  return { supabase, userId: data.user.id };
}

export function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

/** 配列を n 件ずつに分割 */
export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
