import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Card } from '../lib/types';
import { fmtDue, fmtInterval } from '../lib/format';

type Draft = { id?: string; deck: string; front: string; back: string; note: string };

const EMPTY: Draft = { deck: '未分類', front: '', back: '', note: '' };

export default function Cards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<string[]>([]);
  const [deck, setDeck] = useState('');
  const [q, setQ] = useState('');
  const [showSuspended, setShowSuspended] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('cards')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    if (deck) query = query.eq('deck', deck);
    if (!showSuspended) query = query.eq('suspended', false);
    if (q.trim()) query = query.or(`front.ilike.%${q.trim()}%,back.ilike.%${q.trim()}%`);

    const { data, error } = await query;
    if (error) setErr(error.message);
    else setCards((data ?? []) as Card[]);
    setLoading(false);
  }, [deck, q, showSuspended]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    supabase
      .from('cards')
      .select('deck')
      .limit(2000)
      .then(({ data }) => {
        const set = new Set<string>();
        (data ?? []).forEach((r: { deck: string }) => set.add(r.deck));
        setDecks([...set].sort());
      });
  }, [cards.length]);

  async function save() {
    if (!editing) return;
    setErr(null);
    const payload = {
      deck: editing.deck.trim() || '未分類',
      front: editing.front.trim(),
      back: editing.back.trim(),
      note: editing.note.trim() || null,
    };
    if (!payload.front || !payload.back) {
      setErr('表と裏の両方を入力してください。');
      return;
    }
    if (editing.id) {
      const { error } = await supabase.from('cards').update(payload).eq('id', editing.id);
      if (error) return setErr(error.message);
    } else {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('cards')
        .insert({ ...payload, user_id: u.user!.id, origin: 'manual' });
      if (error) return setErr(error.message);
    }
    setEditing(null);
    void load();
  }

  async function toggleSuspend(c: Card) {
    const { error } = await supabase
      .from('cards')
      .update({ suspended: !c.suspended })
      .eq('id', c.id);
    if (error) setErr(error.message);
    else void load();
  }

  async function resetCard(c: Card) {
    const { error } = await supabase
      .from('cards')
      .update({ state: 'new', due: new Date().toISOString(), interval_days: 0, ease: 2.5 })
      .eq('id', c.id);
    if (error) setErr(error.message);
    else void load();
  }

  async function remove(c: Card) {
    if (!confirm('このカードを削除しますか？')) return;
    const { error } = await supabase.from('cards').delete().eq('id', c.id);
    if (error) setErr(error.message);
    else void load();
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <input
            className="grow"
            type="search"
            placeholder="カードを検索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY })}>
            ＋ 追加
          </button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <select value={deck} onChange={(e) => setDeck(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">すべての分野</option>
            {decks.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <label className="row-tight small muted" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showSuspended}
              onChange={(e) => setShowSuspended(e.target.checked)}
              style={{ width: 'auto', minHeight: 0 }}
            />
            保留中も表示
          </label>
        </div>
      </div>

      {err && <div className="alert alert-err">{err}</div>}

      {editing && (
        <div className="card">
          <h2 className="sec">{editing.id ? 'カードを編集' : '新しいカード'}</h2>
          <label className="field">
            <span>分野</span>
            <input
              type="text"
              list="deck-list"
              value={editing.deck}
              onChange={(e) => setEditing({ ...editing, deck: e.target.value })}
            />
            <datalist id="deck-list">
              {decks.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>表（問い）</span>
            <textarea
              value={editing.front}
              onChange={(e) => setEditing({ ...editing, front: e.target.value })}
            />
          </label>
          <label className="field">
            <span>裏（答え）</span>
            <textarea
              value={editing.back}
              onChange={(e) => setEditing({ ...editing, back: e.target.value })}
            />
          </label>
          <label className="field">
            <span>メモ（任意）</span>
            <input
              type="text"
              value={editing.note}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
          </label>
          <div className="row">
            <button className="btn btn-primary" onClick={() => void save()}>
              保存
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="row" style={{ justifyContent: 'center', padding: 20 }}>
            <div className="spinner" />
          </div>
        ) : cards.length === 0 ? (
          <p className="mute2" style={{ margin: 0 }}>
            該当するカードがありません。
          </p>
        ) : (
          <>
            <p className="mute2" style={{ marginTop: 0 }}>
              {cards.length}枚
            </p>
            {cards.map((c) => (
              <div className="list-item" key={c.id}>
                <div className="grow">
                  <div className="t clip2">{c.front}</div>
                  <div className="mute2 clip2">{c.back}</div>
                  <div className="row-tight" style={{ marginTop: 6 }}>
                    <span className="pill">{c.deck}</span>
                    <span className="pill">{fmtDue(c.due)}</span>
                    <span className="pill">{fmtInterval(Number(c.interval_days))}</span>
                    {c.suspended && <span className="pill">保留</span>}
                    {c.origin !== 'manual' && <span className="pill">{c.origin}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      setEditing({
                        id: c.id,
                        deck: c.deck,
                        front: c.front,
                        back: c.back,
                        note: c.note ?? '',
                      })
                    }
                  >
                    編集
                  </button>
                  <button className="btn btn-sm" onClick={() => void toggleSuspend(c)}>
                    {c.suspended ? '復帰' : '保留'}
                  </button>
                  <button className="btn btn-sm" onClick={() => void resetCard(c)}>
                    初期化
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => void remove(c)}>
                    削除
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
