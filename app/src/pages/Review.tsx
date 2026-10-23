import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { RATING_LABELS, type Card } from '../lib/types';
import { fmtInterval } from '../lib/format';

const BATCH = 40;

export default function Review() {
  const [queue, setQueue] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [lastNext, setLastNext] = useState<string | null>(null);
  const shownAt = useRef<number>(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('due_queue', { p_limit: BATCH });
    if (error) setErr(error.message);
    else {
      setQueue((data ?? []) as Card[]);
      setIdx(0);
      setRevealed(false);
      shownAt.current = Date.now();
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const card = queue[idx];

  const grade = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || busy) return;
      setBusy(true);
      const elapsed = Date.now() - shownAt.current;
      const { data, error } = await supabase.rpc('grade_card', {
        p_card_id: card.id,
        p_rating: rating,
        p_elapsed_ms: Math.min(elapsed, 1000 * 60 * 30),
      });
      if (error) {
        setErr(error.message);
      } else {
        const updated = data as Card | null;
        setLastNext(updated ? fmtInterval(Number(updated.interval_days)) : null);
        setDone((n) => n + 1);
        setRevealed(false);
        shownAt.current = Date.now();
        setIdx((i) => i + 1);
      }
      setBusy(false);
    },
    [card, busy],
  );

  // キーボード: Space/Enter でめくる、1〜4 で採点
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!card) return;
      if (!revealed && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        void grade(Number(e.key) as 1 | 2 | 3 | 4);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, grade]);

  if (loading)
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );

  if (err) return <div className="alert alert-err">{err}</div>;

  if (!card) {
    return (
      <div className="stack">
        <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
          <div style={{ fontSize: 34 }}>✅</div>
          <h2 style={{ margin: '8px 0 4px', fontSize: 18 }}>
            {done > 0 ? `${done}枚 完了` : '今日の分は終わっています'}
          </h2>
          <p className="mute2">
            10分後に再出題されるカードがある場合は、少し待ってから再読み込みしてください。
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
            <button className="btn" onClick={() => void load()}>
              キューを再確認
            </button>
            <Link className="btn" to="/">
              ホームへ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const total = queue.length;
  const pct = Math.round((idx / Math.max(1, total)) * 100);

  return (
    <div className="reviewer">
      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="row small muted" style={{ justifyContent: 'space-between' }}>
        <span>
          {idx + 1} / {total}（このセッション {done}枚）
        </span>
        <span className="row-tight">
          <span className="pill">{card.deck}</span>
          {card.state === 'new' && <span className="pill">未学習</span>}
          {card.lapses > 0 && <span className="pill">苦手 {card.lapses}</span>}
        </span>
      </div>

      <div className="qcard" onClick={() => !revealed && setRevealed(true)}>
        {card.front}
        {revealed && (
          <>
            <hr className="divider" />
            <div className="ans">{card.back}</div>
            {card.note && (
              <p className="mute2" style={{ marginBottom: 0 }}>
                {card.note}
              </p>
            )}
          </>
        )}
      </div>

      {!revealed ? (
        <button className="btn btn-primary btn-block" onClick={() => setRevealed(true)}>
          答えを見る<span className="mute2" style={{ marginLeft: 6 }}>Space</span>
        </button>
      ) : (
        <div className="grades">
          {RATING_LABELS.map((r) => (
            <button
              key={r.value}
              className={`btn ${r.cls}`}
              disabled={busy}
              onClick={() => void grade(r.value)}
            >
              <span>{r.label}</span>
              <span className="hint">
                {r.value}・{r.hint}
              </span>
            </button>
          ))}
        </div>
      )}

      {lastNext && (
        <p className="mute2" style={{ textAlign: 'center', margin: 0 }}>
          前のカードは {lastNext}後 に再出題
        </p>
      )}

      <details className="card">
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          このカードの状態
        </summary>
        <table className="tbl" style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <td>現在の間隔</td>
              <td className="num">{fmtInterval(Number(card.interval_days))}</td>
            </tr>
            <tr>
              <td>易しさ係数</td>
              <td className="num">{Number(card.ease).toFixed(2)}</td>
            </tr>
            <tr>
              <td>回答回数</td>
              <td className="num">{card.reps}</td>
            </tr>
            <tr>
              <td>間違えた回数</td>
              <td className="num">{card.lapses}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}
