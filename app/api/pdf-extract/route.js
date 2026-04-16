import { NextResponse } from 'next/server';

// Polyfills de APIs do browser que o pdfjs v5 usa mas não existem em Node.js
function applyPolyfills() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
        this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
        this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
        this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
        this.is2D = true; this.isIdentity = true;
      }
      multiply()        { return new globalThis.DOMMatrix(); }
      translate()       { return new globalThis.DOMMatrix(); }
      scale()           { return new globalThis.DOMMatrix(); }
      rotate()          { return new globalThis.DOMMatrix(); }
      rotateAxisAngle() { return new globalThis.DOMMatrix(); }
      skewX()           { return new globalThis.DOMMatrix(); }
      skewY()           { return new globalThis.DOMMatrix(); }
      inverse()         { return new globalThis.DOMMatrix(); }
      flipX()           { return new globalThis.DOMMatrix(); }
      flipY()           { return new globalThis.DOMMatrix(); }
      transformPoint(p) { return p; }
      toFloat32Array()  { return new Float32Array([1,0,0,1,0,0]); }
      toString()        { return 'matrix(1,0,0,1,0,0)'; }
    };
  }
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {};
  }
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
    };
  }
}

let _lib = null;
async function getPdfJs() {
  if (_lib) return _lib;
  applyPolyfills();
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  _lib = mod.default ?? mod;
  // Worker desabilitado — roda no thread principal (Node.js não precisa de worker para extração de texto)
  if (_lib.GlobalWorkerOptions) _lib.GlobalWorkerOptions.workerSrc = '';
  return _lib;
}

export async function POST(req) {
  try {
    const { base64, password } = await req.json();
    if (!base64) return NextResponse.json({ error: 'base64 obrigatório' }, { status: 400 });

    const lib = await getPdfJs();
    const data = new Uint8Array(Buffer.from(base64, 'base64'));

    let pdf;
    try {
      pdf = await lib.getDocument({
        data,
        password: password || '',
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
      }).promise;
    } catch (err) {
      if (err?.name === 'PasswordException') {
        const wrong = err.message?.toLowerCase().includes('incorrect');
        return NextResponse.json({ status: wrong ? 'wrong_password' : 'needs_password' });
      }
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
