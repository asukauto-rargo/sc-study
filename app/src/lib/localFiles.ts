/**
 * 学習資料PDFを「アップロードせずに」アプリから読むための仕組み。
 *
 * File System Access API で学習資料フォルダへの読み取り権限を一度もらい、
 * そのハンドルを IndexedDB に保存して次回以降も使い回す。
 * ファイルの中身がネットワークに出ることはない。
 *
 * 対応は Chromium 系（Chrome / Edge）のデスクトップのみ。
 * Safari・Firefox・iPhone では isSupported() が false になり、
 * アプリは抽出テキストの表示にフォールバックする。
 */

const DB_NAME = 'sc-study-fs';
const STORE = 'handles';
const KEY = 'materialsDir';

// 標準の lib.dom にまだ無い API があるため、必要なぶんだけ補う
type PermissionMode = { mode?: 'read' | 'readwrite' };
interface DirHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  queryPermission?(d?: PermissionMode): Promise<PermissionState>;
  requestPermission?(d?: PermissionMode): Promise<PermissionState>;
}

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(): Promise<T | null> {
  const db = await openDb();
  const out = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

async function idbDelete(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** 保存済みのフォルダハンドルを取り出す（権限は別途確認が必要） */
export async function loadSavedDirectory(): Promise<DirHandle | null> {
  if (!isSupported()) return null;
  try {
    return await idbGet<DirHandle>();
  } catch {
    return null;
  }
}

/** フォルダ選択ダイアログを出す。ユーザー操作の中から呼ぶこと。 */
export async function pickDirectory(): Promise<DirHandle> {
  const picker = (window as unknown as {
    showDirectoryPicker(o?: { mode?: 'read' | 'readwrite' }): Promise<DirHandle>;
  }).showDirectoryPicker;
  const handle = await picker({ mode: 'read' });
  await idbPut(handle);
  return handle;
}

export async function forgetDirectory(): Promise<void> {
  await idbDelete();
}

export async function permissionState(handle: DirHandle): Promise<PermissionState> {
  if (!handle.queryPermission) return 'granted'; // 問い合わせ手段が無ければ楽観視
  try {
    return await handle.queryPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}

/** 権限を要求する。ユーザー操作の中から呼ぶこと。 */
export async function requestPermission(handle: DirHandle): Promise<boolean> {
  if (!handle.requestPermission) return true;
  try {
    return (await handle.requestPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * フォルダ以下からファイル名が一致する PDF を探す。
 * 学習資料フォルダそのものを選んでも、その親（リポジトリ直下）を選んでも
 * 見つかるように、3階層まで下る。
 */
export async function findPdf(
  root: DirHandle,
  fileName: string,
  depth = 3,
): Promise<File | null> {
  const target = fileName.normalize('NFC');

  async function walk(dir: DirHandle, left: number): Promise<File | null> {
    const subdirs: DirHandle[] = [];
    for await (const [name, entry] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (entry.kind === 'file') {
        if (name.normalize('NFC') === target) {
          return await (entry as FileSystemFileHandle).getFile();
        }
      } else if (left > 0) {
        subdirs.push(entry as DirHandle);
      }
    }
    for (const sub of subdirs) {
      const hit = await walk(sub, left - 1);
      if (hit) return hit;
    }
    return null;
  }

  try {
    return await walk(root, depth);
  } catch {
    return null;
  }
}

/** materials.source_path（例: 学習資料/暗号化技術.pdf）からファイル名だけ取り出す */
export function baseName(sourcePath: string | null, title: string): string {
  if (sourcePath) {
    const n = sourcePath.split('/').pop();
    if (n) return n;
  }
  return `${title}.pdf`;
}
