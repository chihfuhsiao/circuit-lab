// 存檔、讀檔與分享連結。全部在瀏覽器內完成，不會傳到任何伺服器。

import { App } from '../app';
import { parseDoc, serializeDoc } from '../circuit/doc';
import { CircuitDoc } from '../circuit/types';
import { h, modal, toast } from './dom';
import { confirmReplace } from './side';

export function saveFile(app: App): void {
  const blob = new Blob([JSON.stringify(JSON.parse(serializeDoc(app.doc)), null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `${app.doc.title || '電路'}.circuit.json` });
  a.click();
  URL.revokeObjectURL(url);
  app.markSaved();
  toast('已存檔到「下載」資料夾');
}

export function openFile(app: App): void {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const doc = parseDoc(await f.text());
      confirmReplace(app, () => app.loadDoc(doc, doc.comps.some((c) => c.sch) ? 'sch' : 'bb'));
    } catch {
      modal('開不起來', [h('p', {}, `「${f.name}」不是這個軟體存的電路檔。`)]);
    }
  });
  input.click();
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeDoc(doc: CircuitDoc): Promise<string> {
  const bytes = new TextEncoder().encode(serializeDoc(doc));
  if (typeof CompressionStream !== 'undefined') {
    const z = await pipe(bytes, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
    return `z${toBase64Url(z)}`;
  }
  return `j${toBase64Url(bytes)}`;
}

export async function decodeDoc(token: string): Promise<CircuitDoc> {
  const bytes = fromBase64Url(token.slice(1));
  const raw = token[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>) : bytes;
  return parseDoc(new TextDecoder().decode(raw));
}

export async function shareLink(app: App): Promise<void> {
  if (location.protocol === 'file:') {
    modal('分享電路', [h('p', {}, '目前是直接開啟檔案，連結只在這台電腦有效。請改用「存檔」，把電路檔傳給同學或老師；對方用「開啟」就能載入。')]);
    return;
  }
  const url = `${location.origin}${location.pathname}#c=${await encodeDoc(app.doc)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('連結已複製，貼給同學就能打開這個電路');
  } catch {
    const input = h('input', { type: 'text', value: url, style: 'width:100%', 'aria-label': '分享連結' });
    modal('分享連結', [h('p', {}, '請複製這個連結：'), input]);
    input.select();
  }
}

export async function loadFromHash(): Promise<CircuitDoc | null> {
  const m = /#c=(.+)$/.exec(location.hash);
  if (!m) return null;
  try {
    return await decodeDoc(m[1]);
  } catch {
    toast('分享連結的內容不正確，已略過');
    return null;
  }
}
