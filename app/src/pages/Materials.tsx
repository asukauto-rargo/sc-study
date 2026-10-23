import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '../lib/supabase';
import type { Material } from '../lib/types';
import { clamp } from '../lib/format';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface Hit {
  material_id: string;
  material_title: string;
  page: number;
  snippet: string;
  score: number;
}

export default function Materials() {
  const [tab, setTab] = useState<'list' | 'search'>('list');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [open, setOpen] = useState<Material | null>(null);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState('');
  const [rendering, setRendering] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const renderTask = useRef<pdfjs.RenderTask | null>(null);

  useEffect(() => {
    supabase
      .from('materials')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setMaterials((data ?? []) as Material[]);
      });
  }, []);

  // PDF を開く
  const openMaterial = useCallback(async (m: Material, startPage = 1) => {
    setErr(null);
    setOpen(m);
    setTab('list');
    setPage(startPage);
    docRef.current = null;
    if (!m.storage_path) {
      setErr('この資料にはPDFが紐づいていません。取り込みスクリプトを実行してください。');
      return;
    }
    const { data, error } = await supabase.storage
      .from('materials')
      .createSignedUrl(m.storage_path, 3600);
    if (error || !data) {
      setErr(error?.message ?? '署名付きURLを取得できませんでした。');
      return;
    }
    try {
      const doc = await pdfjs.getDocument({ url: data.signedUrl }).promise;
      docRef.current = doc;
      setPage(clamp(startPage, 1, doc.numPages));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ページ描画
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || !open) return;
    let cancelled = false;

    (async () => {
      setRendering(true);
      try {
        renderTask.current?.cancel();
        const p = await doc.getPage(clamp(page, 1, doc.numPages));
        if (cancelled) return;
        const wrapWidth = canvas.parentElement?.clientWidth ?? 800;
        const base = p.getViewport({ scale: 1 });
        const scale = Math.min(2.4, Math.max(0.6, (wrapWidth - 16) / base.width));
        const viewport = p.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / (window.devicePixelRatio || 1))}px`;
        const task = p.render({ canvasContext: ctx, viewport });
        renderTask.current = task;
        await task.promise;
      } catch (e) {
        if (!cancelled && e instanceof Error && e.name !== 'RenderingCancelledException') {
          setErr(e.message);
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, open]);

  // そのページのテキスト（検索でヒットした文脈の確認用）
  useEffect(() => {
    if (!open) return;
    supabase
      .from('material_pages')
      .select('text')
      .eq('material_id', open.id)
      .eq('page', page)
      .maybeSingle()
      .then(({ data }) => setPageText((data as { text: string } | null)?.text ?? ''));
  }, [open, page]);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    const { data, error } = await supabase.rpc('search_pages', {
      p_query: q.trim(),
      p_limit: 40,
    });
    if (error) setErr(error.message);
    else setHits((data ?? []) as Hit[]);
    setSearching(false);
  }

  async function makeCardFromPage() {
    if (!open) return;
    const front = prompt('カードの表（問い）を入力してください');
    if (!front) return;
    const back = prompt('カードの裏（答え）を入力してください', pageText.slice(0, 300));
    if (!back) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('cards').insert({
      user_id: u.user!.id,
      deck: open.title,
      front,
      back,
      origin: 'material',
      source_material_id: open.id,
      source_page: page,
      note: `${open.title} p.${page}`,
    });
    if (error) setErr(error.message);
    else alert('カードを追加しました。');
  }

  const numPages = docRef.current?.numPages ?? open?.page_count ?? 1;

  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <button
            className={`btn btn-sm ${tab === 'list' ? 'btn-primary' : ''}`}
            onClick={() => setTab('list')}
          >
            資料
          </button>
          <button
            className={`btn btn-sm ${tab === 'search' ? 'btn-primary' : ''}`}
            onClick={() => setTab('search')}
          >
            全文検索
          </button>
        </div>
      </div>

      {err && <div className="alert alert-err">{err}</div>}

      {tab === 'search' && (
        <div className="card">
          <form className="row" onSubmit={runSearch}>
            <input
              className="grow"
              type="search"
              placeholder="例: SPF DKIM、セッション固定化、CVSS"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn btn-primary btn-sm" disabled={searching}>
              検索
            </button>
          </form>
          <p className="mute2" style={{ margin: '8px 0 0' }}>
            空白で区切ると AND 検索になります（pgroonga による日本語全文検索）。
          </p>

          {hits && (
            <div style={{ marginTop: 12 }}>
              {hits.length === 0 ? (
                <p className="mute2">ヒットなし。</p>
              ) : (
                hits.map((h) => (
                  <div className="hit" key={`${h.material_id}-${h.page}`}>
                    <div className="row-tight">
                      <span className="pill">{h.material_title}</span>
                      <span className="pill">p.{h.page}</span>
                    </div>
                    <div className="snippet">{h.snippet}</div>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        const m = materials.find((x) => x.id === h.material_id);
                        if (m) void openMaterial(m, h.page);
                      }}
                    >
                      このページを開く
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'list' && !open && (
        <div className="card">
          <h2 className="sec">学習資料</h2>
          {materials.length === 0 ? (
            <p className="small" style={{ margin: 0 }}>
              資料がまだありません。<code>学習資料/</code> に PDF を置いて、Mac のターミナルで
              <code> cd tools &amp;&amp; npm run ingest:materials </code>
              を実行すると、PDF本体と各ページのテキストが取り込まれます。
            </p>
          ) : (
            materials.map((m) => (
              <div className="list-item" key={m.id}>
                <div className="grow">
                  <div className="t">{m.title}</div>
                  <div className="mute2">{m.page_count ?? '?'} ページ</div>
                </div>
                <button className="btn btn-sm" onClick={() => void openMaterial(m)}>
                  開く
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'list' && open && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-sm" onClick={() => setOpen(null)}>
                ← 一覧
              </button>
              <strong className="small">{open.title}</strong>
            </div>
            <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
              <button className="btn btn-sm" onClick={() => setPage((p) => clamp(p - 1, 1, numPages))}>
                前
              </button>
              <input
                type="number"
                className="mono"
                value={page}
                min={1}
                max={numPages}
                onChange={(e) => setPage(clamp(Number(e.target.value) || 1, 1, numPages))}
                style={{ width: 86, textAlign: 'center' }}
              />
              <span className="mute2">/ {numPages}</span>
              <button className="btn btn-sm" onClick={() => setPage((p) => clamp(p + 1, 1, numPages))}>
                次
              </button>
            </div>
          </div>

          <div className="pdfwrap">
            <canvas ref={canvasRef} />
          </div>
          {rendering && (
            <div className="row" style={{ justifyContent: 'center' }}>
              <div className="spinner" />
            </div>
          )}

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 className="sec" style={{ margin: 0 }}>このページのテキスト</h2>
              <button className="btn btn-sm" onClick={() => void makeCardFromPage()}>
                カードにする
              </button>
            </div>
            <div className="pagetext" style={{ marginTop: 8 }}>
              {pageText || '（テキストなし）'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
