import { NextResponse } from 'next/server';

// Roda no servidor (Node.js) — sem problemas de browser compatibility
export async function POST(req) {
  try {
    const { base64, password } = await req.json();
    if (!base64) return NextResponse.json({ error: 'base64 obrigatório' }, { status: 400 });

    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const lib = pdfjsLib.default ?? pdfjsLib;

    // No servidor não há worker — desabilita
    if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = '';

    const binary = Buffer.from(base64, 'base64');
    const data = new Uint8Array(binary);

    // Checa senha e extrai texto
    let pdf;
    try {
      pdf = await lib.getDocument({ data, password: password || '', disableWorker: true }).promise;
    } catch (err) {
      if (err?.name === 'PasswordException') {
        const wrong = err.message?.includes('Incorrect');
        return NextResponse.json({ status: wrong ? 'wrong_password' : 'needs_password' });
      }
      // Qualquer outro erro — retorna sem texto (AI tenta pelo base64)
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
