import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * ローカルの File から PDF の1ページを描画する。
 * このコンポーネントは遅延読み込みなので、PDFを実際に開くまで
 * pdf.js のコード（約340KB）はダウンロードされない。
 */
export default function PdfPane({
  file,
  page,
  onNumPages,
}: {
  file: File;
  page: number;
  onNumPages?: (n: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const taskRef = useRef<pdfjs.RenderTask | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ファイルが変わったら読み直す
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setLoading(true);
    docRef.current = null;

    (async () => {
      try {
        const buf = await file.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        onNumPages?.(doc.numPages);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      const d = docRef.current;
      docRef.current = null;
      if (d) void d.destroy();
    };
    // onNumPages は毎回変わりうるので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // ページを描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading) return;
    let cancelled = false;

    (async () => {
      const doc = docRef.current;
      if (!doc) return;
      try {
        taskRef.current?.cancel();
        const target = Math.min(Math.max(1, page), doc.numPages);
        const p = await doc.getPage(target);
        if (cancelled) return;

        const wrapWidth = canvas.parentElement?.clientWidth ?? 800;
        const base = p.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const scale = Math.min(2.4, Math.max(0.5, (wrapWidth - 16) / base.width));
        const viewport = p.getViewport({ scale: scale * dpr });

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;

        const task = p.render({ canvasContext: ctx, viewport });
        taskRef.current = task;
        await task.promise;
      } catch (e) {
        if (!cancelled && e instanceof Error && e.name !== 'RenderingCancelledException') {
          setErr(e.message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, loading]);

  if (err) return <div className="alert alert-err">PDFを表示できません: {err}</div>;

  return (
    <>
      <div className="pdfwrap">
        <canvas ref={canvasRef} />
      </div>
      {loading && (
        <div className="row" style={{ justifyContent: 'center', padding: 10 }}>
          <div className="spinner" />
        </div>
      )}
    </>
  );
}
