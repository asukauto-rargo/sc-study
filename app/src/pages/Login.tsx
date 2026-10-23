import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        });
        if (error) throw error;
        if (!data.session) {
          setMsg(
            '確認メールを送りました。メール内のリンクを開いてからログインしてください。' +
              '（Supabase の Authentication → Sign In / Providers で「Confirm email」を' +
              'オフにすると、この手順は不要になります）',
          );
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 34, lineHeight: 1 }}>🛡️</div>
          <h1 style={{ fontSize: 19, margin: '10px 0 2px' }}>情報処理安全確保支援士 学習</h1>
          <p className="mute2" style={{ margin: 0 }}>忘却曲線で定着させる</p>
        </div>

        <form className="card" onSubmit={submit}>
          <label className="field">
            <span>メールアドレス</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>パスワード（6文字以上）</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </label>

          {err && <div className="alert alert-err" style={{ marginBottom: 12 }}>{err}</div>}
          {msg && <div className="alert alert-ok" style={{ marginBottom: 12 }}>{msg}</div>}

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? '処理中…' : mode === 'in' ? 'ログイン' : 'アカウント作成'}
          </button>

          <button
            type="button"
            className="btn btn-block btn-sm"
            style={{ marginTop: 10, border: 0, background: 'transparent' }}
            onClick={() => {
              setMode(mode === 'in' ? 'up' : 'in');
              setErr(null);
              setMsg(null);
            }}
          >
            {mode === 'in' ? 'はじめて使う（アカウント作成）' : 'すでにアカウントがある'}
          </button>
        </form>
      </div>
    </div>
  );
}
