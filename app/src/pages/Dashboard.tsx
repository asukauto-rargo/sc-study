import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { DashboardStats } from '../lib/types';
import { fmtInterval } from '../lib/format';

function Bars({
  data,
  highlightFirst,
}: {
  data: { date: string; count: number }[];
  highlightFirst?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <>
      <div className="bars">
        {data.map((d, i) => (
          <div
            key={d.date}
            className={`b${d.count === 0 ? ' zero' : ''}${
              highlightFirst && i === 0 ? ' today' : ''
            }`}
            style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
            title={`${d.date}: ${d.count}`}
          />
        ))}
      </div>
      <div className="axis">
        {/* ラベルは4点だけ。本数が多いと重なって読めなくなるため */}
        {[0, Math.floor(data.length / 3), Math.floor((data.length * 2) / 3), data.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i && data[v])
          .map((i) => (
            <span key={i}>{data[i].date.slice(5).replace('-', '/')}</span>
          ))}
      </div>
    </>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .rpc('dashboard_stats', { p_tz: 'Asia/Tokyo' })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setStats(data as DashboardStats);
      });
  }, []);

  if (err) return <div className="alert alert-err">{err}</div>;
  if (!stats)
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );

  const { cards, reviews, by_deck, forecast, daily, streak, attempts, qbank } = stats;
  const dueLabel =
    cards.due_now > 0 ? `今日の復習 ${cards.due_now}枚` : '今日の復習はありません';

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--fg-mute)' }}>忘却曲線にそった復習</div>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.4 }}>{dueLabel}</div>
          </div>
          {streak > 0 && <span className="pill pill-accent">🔥 {streak}日連続</span>}
        </div>
        <Link
          to="/review"
          className="btn btn-primary btn-block"
          style={{ marginTop: 12, pointerEvents: cards.due_now > 0 ? 'auto' : 'none', opacity: cards.due_now > 0 ? 1 : 0.45 }}
        >
          復習をはじめる
        </Link>
        {cards.total === 0 && (
          <p className="mute2" style={{ marginBottom: 0 }}>
            カードがまだありません。<Link to="/cards">カード</Link>から手で追加するか、
            <code>npm run ingest:materials</code> で学習資料から取り込んでください。
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="sec">カードの状況</h2>
        <div className="kpis">
          <div className="kpi">
            <div className="v mono">{cards.total}</div>
            <div className="k">総カード数</div>
          </div>
          <div className="kpi">
            <div className="v mono">{cards.new_cards}</div>
            <div className="k">未学習</div>
          </div>
          <div className="kpi">
            <div className="v mono">{cards.mature}</div>
            <div className="k">復習段階</div>
          </div>
          <div className="kpi">
            <div className="v mono">{reviews.retention30}%</div>
            <div className="k">30日定着率</div>
          </div>
          <div className="kpi">
            <div className="v mono">{reviews.today}</div>
            <div className="k">今日の回答</div>
          </div>
          <div className="kpi">
            <div className="v mono">{fmtInterval(cards.avg_interval)}</div>
            <div className="k">平均間隔</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="sec">これから14日の復習予定</h2>
        <Bars data={forecast} highlightFirst />
      </div>

      <div className="card">
        <h2 className="sec">直近30日の回答数</h2>
        <Bars data={daily.slice().reverse()} />
        <p className="mute2" style={{ margin: '8px 0 0' }}>
          直近7日 {reviews.last7}回 / 30日 {reviews.last30}回
        </p>
      </div>

      {by_deck.length > 0 && (
        <div className="card">
          <h2 className="sec">分野別</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>分野</th>
                <th className="num">枚</th>
                <th className="num">未学習</th>
                <th className="num">要復習</th>
                <th className="num">間隔</th>
              </tr>
            </thead>
            <tbody>
              {by_deck.map((d) => (
                <tr key={d.deck}>
                  <td>{d.deck}</td>
                  <td className="num">{d.total}</td>
                  <td className="num">{d.new}</td>
                  <td className="num">{d.due}</td>
                  <td className="num">{fmtInterval(d.avg_interval)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 className="sec">過去問</h2>
        {attempts.attempts === 0 ? (
          <p className="mute2" style={{ margin: 0 }}>
            まだ記録がありません。<Link to="/practice">問題</Link>から演習をはじめてください。
          </p>
        ) : (
          <div className="kpis">
            <div className="kpi">
              <div className="v mono">{attempts.attempts}</div>
              <div className="k">総解答数</div>
            </div>
            <div className="kpi">
              <div className="v mono">{attempts.accuracy}%</div>
              <div className="k">正答率</div>
            </div>
            <div className="kpi">
              <div className="v mono">{attempts.last7}</div>
              <div className="k">直近7日</div>
            </div>
          </div>
        )}
        <p className="mute2" style={{ marginBottom: 0, marginTop: 10 }}>
          取り込み済みの問題: 科目A-1 {qbank.a1 ?? 0}問 / 科目A-2 {qbank.a2 ?? 0}問 / 科目B{' '}
          {qbank.b ?? 0}問
        </p>
      </div>
    </div>
  );
}
