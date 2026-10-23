import { createClient } from '@supabase/supabase-js';

/**
 * 接続先の既定値。
 * publishable key はブラウザに配布される前提の公開鍵で、
 * データの保護は Supabase の RLS（行レベルセキュリティ）が担っている。
 * そのため公開リポジトリにこの値が入っていても、他人のデータは読めない。
 *
 * 別プロジェクトに向けたいときは app/.env.local（git管理外）で上書きする:
 *   VITE_SUPABASE_URL=...
 *   VITE_SUPABASE_PUBLISHABLE_KEY=...
 */
const DEFAULT_URL = 'https://znhilwkohgsdgygzlvrr.supabase.co';
const DEFAULT_KEY = 'sb_publishable_ZanEV4Iux80ZHpUkE00mLA_R3j3rdy9';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || DEFAULT_KEY;

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // HashRouter と衝突させない
  },
});

export const SUPABASE_URL = url;
