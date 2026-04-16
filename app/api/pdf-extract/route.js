import { NextResponse } from 'next/server';

// Usa o pdfjs v2.0.550 empacotado dentro do pdf-parse.
// Este build é específico para Node.js: sem workers, sem APIs de browser.
// O pdf-parse em si não passa a senha para o pdfjs — por isso usamos o pdfjs diretamente.

let _pdfjs = null;
function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  // Importação síncrona (CommonJS) — o pdfjs desse bundle é CJS puro
  _pdfjs = require('pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js');
  _pdfjs.disableWorker = true; // Roda no thread principal (Node.js)
  return _pdfjs;
}

async function extractText(PDFJS, buffer, password) {
  const loadOptions = { data: buffer };
  if (password) loadOptions.password = password;

  const doc = await PDFJS.getDocument(loadOptions);

  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter(item => typeof item.str === 'string')
      .map(item => item.str)
      .join(' ');
    text += `--- Página ${i} ---\n${pageText}\n\n`;
  }

  doc.destroy();
  return text || null;
}

export async function POST(req) {
  try {
    const { base64, password } = await req.json();
    if (!base64) return NextResponse.json({ error: 'base64 obrigatório' }, { status: 400 });

    const buffer = Buffer.from(base64, 'base64');
    const PDFJS = getPdfJs();

    let text;
    try {
      text = await extractText(PDFJS, buffer, password || null);
    } catch (err) {
      const name = err?.name || '';
      const msg  = (err?.message || '').toLowerCase();

      // PasswordException = PDF protegido por senha
      if (name === 'PasswordException') {
        // msg contém 'no password given' (precisa de senha) ou 'incorrect password' (senha errada)
        if (password && msg.includes('incorrect')) {
          return NextResponse.json({ status: 'wrong_password' });
        }
        return NextResponse.json({ status: 'needs_password' });
      }

      console.error('[pdf-extract] parse error:', name, err?.message);
      return NextResponse.json({ status: 'ok', text: null });
    }

    return NextResponse.json({ status: 'ok', text });

  } catch (err) {
    console.error('[pdf-extract] route error:', err?.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
