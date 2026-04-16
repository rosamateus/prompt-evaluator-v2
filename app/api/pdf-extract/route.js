import { NextResponse } from 'next/server';

// pdf-parse v1.1.1 — biblioteca Node.js pura, sem workers, sem APIs de browser

export async function POST(req) {
  try {
    const { base64, password } = await req.json();
    if (!base64) return NextResponse.json({ error: 'base64 obrigatório' }, { status: 400 });

    const buffer = Buffer.from(base64, 'base64');

    // Importação dinâmica para evitar problemas de tree-shaking no build
    const { default: pdfParse } = await import('pdf-parse');

    const options = {};
    if (password) options.password = password;

    let result;
    try {
      result = await pdfParse(buffer, options);
    } catch (err) {
      const name = err?.name || '';
      const msg  = (err?.message || '').toLowerCase();

      // PasswordException = PDF protegido por senha
      if (name === 'PasswordException' || msg.includes('password') || msg.includes('encrypt')) {
        if (password && (msg.includes('incorrect') || msg.includes('wrong'))) {
          return NextResponse.json({ status: 'wrong_password' });
        }
        return NextResponse.json({ status: 'needs_password' });
      }

      console.error('[pdf-extract] parse error:', name, err?.message);
      return NextResponse.json({ status: 'ok', text: null });
    }

    const text = result.text || null;
    return NextResponse.json({ status: 'ok', text });

  } catch (err) {
    console.error('[pdf-extract] route error:', err?.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
