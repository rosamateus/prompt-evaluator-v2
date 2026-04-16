import { NextResponse } from 'next/server';

let _pdfjsLib = null;
async function getPdfJs(workerSrc) {
  if (_pdfjsLib) return _pdfjsLib;
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lib = mod.default ?? mod;
  if (lib.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc = workerSrc;
  }
  _pdfjsLib = lib;
  return lib;
}

export async function POST(req) {
  try {
    const { base64, password } = await req.json();
    if (!base64) return NextResponse.json({ error: 'base64 obrigatório' }, { status: 400 });

    // Usa o host da requisição para apontar pro worker em /public — funciona local e em produção
    const host = req.headers.get('host');
    const protocol = host?.includes('localhost') ? 'http' : 'https';
    const workerSrc = `${protocol}://${host}/pdf.worker.min.mjs`;

    const lib = await getPdfJs(workerSrc);
    const data = new Uint8Array(Buffer.from(base64, 'base64'));

    let pdf;
    try {
      pdf = await lib.getDocument({ data, password: password || '' }).promise;
    } catch (err) {
      if (err?.name === 'PasswordException') {
        const wrong = err.message?.toLowerCase().includes('incorrect');
        return NextResponse.json({ status: wrong ? 'wrong_password' : 'needs_password' });
      }
      // Erro inesperado — loga e retorna sem texto
      console.error('[pdf-extract] getDocument error:', err?.message);
      return NextResponse.json({ status: 'ok', text: null });
    }

    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items
        .filter(x => typeof x.str === 'string')
        .map(x => x.str);
      text += `--- Página ${i} ---\n${strings.join(' ')}\n\n`;
    }

    return NextResponse.json({ status: 'ok', text });
  } catch (err) {
    console.error('[pdf-extract] route error:', err?.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
