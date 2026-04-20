'use client';

import { useState, useEffect, useRef } from 'react';
import { jsonrepair } from 'jsonrepair';

// ─── PDF HELPERS — processamento via API route (Node.js server) ───
// Evita qualquer problema de browser compatibility com pdfjs

async function checkPdfPassword(base64, password) {
  const res = await fetch('/api/pdf-extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, password }),
  });
  const data = await res.json();
  if (data.status === 'needs_password') return 'needs_password';
  if (data.status === 'wrong_password') return 'wrong_password';
  return false;
}

async function extractTextFromPdf(base64, password) {
  const res = await fetch('/api/pdf-extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, password }),
  });
  const data = await res.json();
  return data.text || null;
}

// ─── SYSTEM PROMPT (prompt exato do app) ───
const SYSTEM_PROMPT = `Extrator de dados de apólices de seguro CARRO/AUTOMÓVEL (Brasil). O input é o PDF COMPLETO da apólice.

SAÍDA: um único objeto JSON válido com APENAS os campos abaixo. Sem texto antes ou depois. Sem markdown code fences.

Campos raiz (strings, null se não encontrado):
- numeroApolice
- nomeSeguradora
- valor (prêmio total, número sem R$)
- cep
- logradouro
- bairro
- cidade
- estado (UF, 2 letras)
- dataInicio (vigência início, YYYY-MM-DD)
- dataFim (vigência fim, YYYY-MM-DD)
- nomeSegurado
- telefoneSegurado
- dataNascimentoSegurado (YYYY-MM-DD)
- generoSegurado ("Masculino" ou "Feminino", nunca abreviação)
- emailSegurado
- marcaVeiculo
- modeloVeiculo
- anoFabricacao (número)
- chassi
- placa
- classeBonus (número inteiro de 0 a 10, null se não informado)

Campos extras do veículo (na raiz):
- anoModelo (número)
- combustivel
- codigoFipe
- usoVeiculo
- categoriaVeiculo
- lotacao (número)
- cepPernoite

Objeto condutor principal:
- condutorPrincipal: { nome, dataNascimento (YYYY-MM-DD, apenas se constar explicitamente na apólice), idade (número inteiro, apenas se a data de nascimento NÃO estiver disponível), genero ("Masculino" ou "Feminino"), estadoCivil, vinculoSegurado, eOSegurado (boolean) }

Array de franquias (TODAS, incluindo vidros/faróis em notas de rodapé):
- franquias: [{ nome, descricao, valor (número) }]

Array de coberturas CONTRATADAS (excluir "não contratadas"):
- coberturasContratadas: [{ nome, lmi, premio (número), descricao }]

Array de serviços adicionais (assistência 24h, carro reserva, vidros, etc.):
- servicosAdicionais: [{ nome, detalhes, premio (número) }]

Objeto de pagamento:
- pagamento: { premioLiquido (número), iof (número), premioTotal (número), formaPagamento, parcelas (número), valorParcela (número) }

Outras informações relevantes não mapeadas acima:
- outrasInformacoes: { observacoes: ["string"] }

REGRAS GERAIS:
- Valores monetários: números sem R$ (ex: 1234.56)
- Datas: formato YYYY-MM-DD
- null para campos não encontrados
- Coberturas "Não contratado" NÃO incluir
- Retorne SOMENTE o JSON

REGRAS ESPECÍFICAS POR CAMPO:

nomeSeguradora:
- Use o NOME COMERCIAL ou MARCA do produto, não a razão social da empresa.
- Ex: use "Azul Seguro" (não "Porto Seguro") quando o produto for Azul Seguro Auto.
- Ex: use "Aliro Seguro" (não "Yelum Seguros S.A.") quando o produto for Aliro.
- Procure o nome/marca destacado na capa ou cabeçalho da apólice.

generoSegurado e condutorPrincipal.genero:
- Sempre por extenso: "Masculino" ou "Feminino". Nunca "M", "F" ou outra abreviação.

codigoFipe:
- Extraia EXCLUSIVAMENTE o código da Tabela FIPE Nacional (geralmente 6 dígitos, ex: 152005).
- Ignore códigos internos da seguradora. O código FIPE costuma estar identificado como "Código FIPE" no documento.

cep e cepPernoite:
- Formato completo com 8 dígitos incluindo o sufixo (ex: "11015-070").
- Se o PDF apresentar sem hífen (ex: "11015070"), normalize para "11015-070".
- Nunca extraia apenas os primeiros 5 dígitos.

condutorPrincipal.vinculoSegurado:
- Descreva o RELACIONAMENTO do condutor com o segurado: "O próprio", "Cônjuge", "Filho/a", "Funcionário", etc.
- Não preencha com profissão ou atividade profissional do condutor.

condutorPrincipal.dataNascimento e condutorPrincipal.idade:
- Se a data de nascimento estiver EXPLICITAMENTE informada na apólice → extraia em condutorPrincipal.dataNascimento (YYYY-MM-DD). Omita condutorPrincipal.idade.
- Se a data de nascimento NÃO estiver disponível mas a IDADE estiver informada (ex: "42 anos") → extraia condutorPrincipal.idade como número inteiro (ex: 42). Omita condutorPrincipal.dataNascimento.
- Nunca estime nem calcule datas de nascimento a partir da idade. Nunca inclua ambos os campos ao mesmo tempo. Não registre nenhuma observação sobre isso.

classeBonus:
- Número inteiro de 0 a 10 que representa o histórico de sinistros do condutor (presente principalmente em apólices Allianz).
- null se não informado.

pagamento.premioLiquido:
- Deve conter o PRÊMIO LÍQUIDO TOTAL da apólice: soma do prêmio líquido de TODAS as coberturas (principais + adicionais + serviços).
- Não capture apenas o prêmio líquido das coberturas principais — localize o valor total consolidado que antecede o IOF na tabela de pagamento.

coberturasContratadas:
- Inclua TODAS as coberturas listadas como contratadas, mesmo aquelas com prêmio R$ 0,00 ou marcadas como "GRATUITA".
- Para coberturas gratuitas, defina premio: 0.
- Exemplos de coberturas gratuitas a NÃO ignorar: "Extensão de Perímetro", "Isenção de Pagamento de Franquia", "Proteção de Acessórios".

coberturasContratadas[].lmi:
- Extraia o valor EXATAMENTE como aparece no documento: pode ser valor monetário ("R$ 75.000,00"), percentual da FIPE ("80% da FIPE") ou percentual do veículo ("100% do valor de referência").
- Nunca deixe null quando o LMI estiver expresso como percentual.

franquias:
- Quando uma franquia tiver valores distintos por sub-item (ex: vidro dianteiro R$ 710, traseiro R$ 620, lateral R$ 245), crie UMA entrada no array para CADA sub-item, com nome específico e valor numérico correspondente.
- Nunca agrupe sub-itens com valores distintos em uma única entrada com valor: null.
- Inclua franquias de vidros, faróis, lanternas e retrovisores mesmo que apareçam em notas de rodapé.
- O valor de uma franquia pode ser R$ 0,00 — extraia como 0 (zero), nunca como null.`;


// ─── PROVIDERS CONFIG ───
const USER_MSG = () =>
  `Analise o PDF da apólice de seguro auto e extraia todos os dados conforme as instruções. Retorne APENAS o JSON válido.`;

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'],
    defaultModel: 'claude-sonnet-4-20250514',
    call: async (apiKey, model, base64, password, textContent) => {
      const userContent = textContent
        ? [{ type: 'text', text: `Conteúdo extraído do PDF:\n\n${textContent}\n\n${USER_MSG()}` }]
        : [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: USER_MSG() },
          ];
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.content?.map(b => b.text || '').join('') || '';
    }
  },
  openai: {
    label: 'OpenAI (GPT)',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    defaultModel: 'gpt-4o',
    call: async (apiKey, model, base64, password, textContent) => {
      const userContent = textContent
        ? [{ type: 'text', text: `Conteúdo extraído do PDF:\n\n${textContent}\n\n${USER_MSG()}` }]
        : [
            { type: 'text', text: USER_MSG() },
            { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}` } },
          ];
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.choices?.[0]?.message?.content || '';
    }
  },
  google: {
    label: 'Google (Gemini)',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    call: async (apiKey, model, base64, password, textContent) => {
      const isThinkingModel = model.includes('2.5');
      const body = {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          parts: textContent
            ? [{ text: `Conteúdo extraído do PDF:\n\n${textContent}\n\n${USER_MSG()}` }]
            : [
                { inline_data: { mime_type: 'application/pdf', data: base64 } },
                { text: USER_MSG() },
              ]
        }],
        generationConfig: {
          maxOutputTokens: 65536,
          ...(isThinkingModel ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        }
      };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const finishReason = data.candidates?.[0]?.finishReason;
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('O Gemini atingiu o limite de tokens e retornou resposta incompleta. Tente com gemini-2.5-pro ou um PDF menor.');
      }
      return `__FINISH__${finishReason}__\n${text}`;
    }
  },
};

// ─── HELPERS ───
const fmt = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return String(v);
};

const STORAGE_KEY = 'prompt-eval-v2-settings';
const loadSettings = () => {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
};
const saveSettings = (s) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
};

// ─── COMPONENTS ───
function FeedbackBtn({ status, onToggle, fieldPath }) {
  const cfgs = {
    none: { bg: '#F5F3EE', bd: '#E0DCD5', icon: '○', c: '#AAA' },
    correct: { bg: '#E8F5E9', bd: '#A5D6A7', icon: '✓', c: '#2E7D32' },
    wrong: { bg: '#FFEBEE', bd: '#EF9A9A', icon: '✗', c: '#C62828' },
    missing: { bg: '#FFF3E0', bd: '#FFCC80', icon: '?', c: '#E65100' },
  };
  const x = cfgs[status];
  const next = { none: 'correct', correct: 'wrong', wrong: 'missing', missing: 'none' };
  return (
    <button onClick={() => onToggle(fieldPath, next[status])} style={{
      background: x.bg, border: `1.5px solid ${x.bd}`, borderRadius: 8, width: 30, height: 30,
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      fontSize: 15, color: x.c, fontWeight: 700, flexShrink: 0, transition: 'all 0.15s ease',
      fontFamily: 'system-ui',
    }}>{x.icon}</button>
  );
}

function EvalRow({ label, value, fieldPath, feedbacks, onToggle, onComment }) {
  const fb = feedbacks[fieldPath] || {};
  const status = fb.status || 'none';
  const [showInput, setShowInput] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid #F0EDE8' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
        <FeedbackBtn status={status} onToggle={onToggle} fieldPath={fieldPath} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#999', display: 'block' }}>{label}</span>
          <span style={{ fontSize: 13, color: '#1A1A1A', fontWeight: 500, wordBreak: 'break-word' }}>
            {typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : (value ?? '—')}
          </span>
        </div>
        {(status === 'wrong' || status === 'missing') && (
          <button onClick={() => setShowInput(!showInput)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 }}>💬</button>
        )}
      </div>
      {showInput && (
        <div style={{ paddingBottom: 10, paddingLeft: 38 }}>
          <input type="text" placeholder={status === 'wrong' ? 'Qual o valor correto?' : 'O que está faltando?'}
            value={fb.comment || ''} onChange={(e) => onComment(fieldPath, e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid #E0DCD5', fontSize: 13, fontFamily: "'DM Sans',sans-serif", outline: 'none', background: '#FAFAF8' }}
          />
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, badge, children, defaultOpen = false, warningBanner }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: '#fff', borderRadius: 16, marginBottom: 10, border: '1px solid #F0EDE8', overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A' }}>{title}</span>
          {badge != null && (
            <span style={{ background: '#5B2D8E', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '1px 7px', lineHeight: 1.6 }}>{badge}</span>
          )}
        </div>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.25s ease' }}>
          <path d="M5 7.5L10 12.5L15 7.5" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          {warningBanner && (
            <div style={{ background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#795548', lineHeight: 1.5 }}>
              {warningBanner}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ───
export default function Page() {
  const [step, setStep] = useState('upload');
  const ENV_PROVIDER    = process.env.NEXT_PUBLIC_DEFAULT_PROVIDER    || 'anthropic';
  const ENV_MODEL       = process.env.NEXT_PUBLIC_DEFAULT_MODEL       || '';
  const ENV_API_KEY     = process.env.NEXT_PUBLIC_DEFAULT_API_KEY     || '';
  const ENV_SUPA_URL    = process.env.NEXT_PUBLIC_DEFAULT_SUPABASE_URL  || '';
  const ENV_SUPA_KEY    = process.env.NEXT_PUBLIC_DEFAULT_SUPABASE_KEY  || '';

  const [provider, setProvider] = useState(ENV_PROVIDER);
  const [model, setModel] = useState(ENV_MODEL || PROVIDERS[ENV_PROVIDER]?.defaultModel || PROVIDERS.anthropic.defaultModel);
  const [apiKey, setApiKey] = useState(ENV_API_KEY);
  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState(null);
  const [result, setResult] = useState(null);
  const [rawResponse, setRawResponse] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [feedbacks, setFeedbacks] = useState({});
  const [generalNotes, setGeneralNotes] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [pdfPassword, setPdfPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState(ENV_SUPA_URL);
  const [supabaseKey, setSupabaseKey] = useState(ENV_SUPA_KEY);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error' | string
  const [hasSaved, setHasSaved] = useState(false); // impede duplo salvamento
  const fileRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const s = loadSettings();
    if (s) {
      // Env vars da Vercel têm prioridade absoluta sobre localStorage.
      // localStorage só preenche campos que não têm env var configurada.
      if (s.provider && !ENV_PROVIDER) setProvider(s.provider);
      if (s.model   && !ENV_MODEL)    setModel(s.model);
      if (s.apiKey  && !ENV_API_KEY)  setApiKey(s.apiKey);
      if (s.supabaseUrl && !ENV_SUPA_URL) setSupabaseUrl(s.supabaseUrl);
      if (s.supabaseKey && !ENV_SUPA_KEY) setSupabaseKey(s.supabaseKey);
    }
  }, []);

  useEffect(() => {
    saveSettings({ provider, model, apiKey, supabaseUrl, supabaseKey });
  }, [provider, model, apiKey, supabaseUrl, supabaseKey]);

  const handleProviderChange = (p) => {
    setProvider(p);
    setModel(PROVIDERS[p].defaultModel);
  };

  const loadingMessages = [
    'Lendo o PDF da apólice...', 'Identificando a seguradora...', 'Extraindo coberturas e franquias...',
    'Mapeando dados do veículo...', 'Processando dados de pagamento...', 'Montando o JSON estruturado...',
  ];

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setIsEncrypted(false);
    setPdfPassword('');
    const reader = new FileReader();
    reader.onload = () => setFileData(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  };

  const processFile = async (passwordOverride) => {
    if (!fileData || !apiKey) { setError('Selecione um PDF e configure a API key.'); return; }

    // Garante que nunca recebe um evento DOM como passwordOverride
    const safeOverride = (typeof passwordOverride === 'string') ? passwordOverride : undefined;
    const password = safeOverride ?? pdfPassword;

    setLoading(true);
    setError(null);
    setElapsedTime(0);

    const start = Date.now();
    timerRef.current = setInterval(() => setElapsedTime(Math.floor((Date.now() - start) / 1000)), 1000);

    let msgIdx = 0;
    setLoadingMsg(loadingMessages[0]);
    const msgInterval = setInterval(() => { msgIdx = (msgIdx + 1) % loadingMessages.length; setLoadingMsg(loadingMessages[msgIdx]); }, 2200);

    try {
      let textContent = null;

      // Verifica senha e extrai texto — sempre via servidor (funciona em qualquer device)
      setLoadingMsg('Verificando PDF...');

      if (!isEncrypted) {
        const pwdStatus = await checkPdfPassword(fileData, undefined);
        if (pwdStatus === 'needs_password') {
          setIsEncrypted(true);
          setShowPasswordModal(true);
          clearInterval(msgInterval);
          clearInterval(timerRef.current);
          setLoading(false);
          return;
        }
      }

      if (isEncrypted || password) {
        // PDF com senha: verifica e extrai texto descriptografado
        setLoadingMsg('Descriptografando PDF...');
        const pwdStatus = await checkPdfPassword(fileData, password);
        if (pwdStatus === 'wrong_password') throw new Error('Senha incorreta. Tente novamente.');
        textContent = await extractTextFromPdf(fileData, password);
      } else {
        // PDF sem senha: extrai texto no servidor para evitar limitações de MIME type da API
        setLoadingMsg('Lendo o PDF da apólice...');
        textContent = await extractTextFromPdf(fileData, null);
      }

      const raw = await PROVIDERS[provider].call(apiKey, model, fileData, undefined, textContent);

      let finishReason = null;
      let text = raw;
      const finishMatch = raw.match(/^__FINISH__([^_]*)__\n/);
      if (finishMatch) {
        finishReason = finishMatch[1];
        text = raw.slice(finishMatch[0].length);
      }
      setRawResponse(text);

      let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonStart = clean.indexOf('{');
      const jsonEnd = clean.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        clean = clean.substring(jsonStart, jsonEnd + 1);
      }

      let parsed;
      try {
        const repaired = jsonrepair(clean);
        parsed = JSON.parse(repaired);
      } catch (parseErr) {
        throw new Error(`PARSE_ERROR|||${parseErr.message}|||${clean.substring(0, 600)}`);
      }

      // Warn if response looks incomplete
      const EXPECTED_KEYS = ['nomeSegurado', 'marcaVeiculo', 'coberturasContratadas', 'pagamento'];
      const missingKeys = EXPECTED_KEYS.filter(k => !parsed[k]);
      if (missingKeys.length >= 3) {
        const hint = finishReason ? ` (finishReason: ${finishReason})` : '';
        parsed.__warning__ = `Resposta possivelmente incompleta — campos ausentes: ${missingKeys.join(', ')}${hint}. O modelo pode não ter conseguido ler o PDF.`;
      }

      setResult(parsed);
      setFeedbacks({});
      setGeneralNotes('');
      setStep('evaluate');
    } catch (err) {
      setError(err.message || 'Erro ao processar');
    }
    clearInterval(msgInterval);
    clearInterval(timerRef.current);
    setLoading(false);
  };

  const toggleFeedback = (path, newStatus) => {
    setFeedbacks(prev => ({ ...prev, [path]: { ...prev[path], status: newStatus, comment: prev[path]?.comment || '' } }));
  };
  const setComment = (path, comment) => {
    setFeedbacks(prev => ({ ...prev, [path]: { ...prev[path], comment } }));
  };

  const stats = {
    total: Object.values(feedbacks).filter(v => v.status && v.status !== 'none').length,
    correct: Object.values(feedbacks).filter(v => v.status === 'correct').length,
    wrong: Object.values(feedbacks).filter(v => v.status === 'wrong').length,
    missing: Object.values(feedbacks).filter(v => v.status === 'missing').length,
  };

  const buildSummary = (includePdf = false) => ({
    arquivo: fileName,
    data_avaliacao: new Date().toISOString(),
    provider,
    modelo: model,
    tempo_processamento_segundos: elapsedTime,
    seguradora: result?.nomeSeguradora,
    apolice: result?.numeroApolice,
    notas_gerais: generalNotes,
    avaliacoes: Object.entries(feedbacks)
      .filter(([, v]) => v.status && v.status !== 'none')
      .map(([path, v]) => ({ campo: path, status: v.status, comentario: v.comment || null })),
    estatisticas: stats,
    json_extraido: result,
    ...(includePdf ? { pdf_base64: fileData || null } : {}),
    pdf_senha: pdfPassword || null,
  });

  const downloadJson = (summary) => {
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feedback-v2-${provider}-${model}-${fileName.replace('.pdf', '')}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveFeedback = async () => {
    const summary = buildSummary(true); // mesmo conteúdo do arquivo .json baixado

    if (!supabaseUrl || !supabaseKey) {
      // Sem banco configurado: baixa o arquivo localmente
      downloadJson(summary);
      setSaveStatus('saved');
      setHasSaved(true);
      setTimeout(() => { setSaveStatus(null); setStep('upload'); setResult(null); setHasSaved(false); }, 2000);
      return;
    }

    setSaveStatus('saving');

    try {
      // Passo 1: serializar o JSON
      let jsonString;
      try {
        jsonString = JSON.stringify(summary, null, 2);
      } catch (e) {
        throw new Error(`stringify: ${e.message}`);
      }

      // Passo 2: upload para o Storage
      // Supabase Storage não aceita acentos, espaços ou caracteres especiais no nome
      const sanitize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const storageFileName = `feedback-v2-${sanitize(provider)}-${sanitize(model)}-${sanitize(fileName.replace('.pdf', ''))}-${Date.now()}.json`;
      let uploadRes;
      try {
        uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/feedbacks/${storageFileName}`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'x-upsert': 'true',
          },
          body: jsonString,
        });
      } catch (e) {
        throw new Error(`fetch-storage: ${e.message}`);
      }
      if (!uploadRes.ok) {
        const errBody = await uploadRes.text().catch(() => uploadRes.status);
        throw new Error(`storage-${uploadRes.status}: ${errBody}`);
      }

      // Passo 3: salvar na tabela
      const fileUrl = `${supabaseUrl}/storage/v1/object/public/feedbacks/${storageFileName}`;
      const row = {
        data_avaliacao: new Date().toISOString(),
        arquivo: fileName,
        segurado: result?.nomeSegurado || null,
        seguradora: result?.nomeSeguradora || null,
        apolice: result?.numeroApolice || null,
        provider,
        modelo: model,
        tempo_segundos: elapsedTime,
        total_avaliacoes: stats.total,
        corretos: stats.correct,
        errados: stats.wrong,
        faltando: stats.missing,
        notas: generalNotes || null,
        feedback_file_url: fileUrl,
        feedback_file_name: storageFileName,
      };
      let dbRes;
      try {
        dbRes = await fetch(`${supabaseUrl}/rest/v1/feedbacks`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(row),
        });
      } catch (e) {
        throw new Error(`fetch-db: ${e.message}`);
      }
      if (!dbRes.ok) {
        const errBody = await dbRes.text().catch(() => dbRes.status);
        throw new Error(`db-${dbRes.status}: ${errBody}`);
      }

      setSaveStatus('saved');
      setHasSaved(true);
      setTimeout(() => { setSaveStatus(null); setStep('upload'); setResult(null); setHasSaved(false); }, 2000);
    } catch (err) {
      setSaveStatus(`error: ${err.message}`);
      setTimeout(() => setSaveStatus(null), 8000);
    }
  };

  const r = result;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', fontFamily: "'DM Sans',sans-serif", background: '#F7F4EF', minHeight: '100vh' }}>

      {/* ═══ PASSWORD MODAL ═══ */}
      {showPasswordModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360, fontFamily: "'DM Sans',sans-serif" }}>
            <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 10 }}>🔒</div>
            <h2 style={{ fontFamily: "'Source Serif 4',serif", fontSize: 20, fontWeight: 700, color: '#1A1A1A', margin: '0 0 6px', textAlign: 'center' }}>PDF Protegido</h2>
            <p style={{ fontSize: 13, color: '#888', textAlign: 'center', margin: '0 0 18px' }}>
              Este PDF está com senha. Digite abaixo para continuar.
            </p>
            <input
              type="password"
              placeholder="Senha do PDF..."
              value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pdfPassword) {
                  setShowPasswordModal(false);
                  processFile(pdfPassword);
                }
              }}
              autoFocus
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E0DCD5', fontSize: 14, fontFamily: "'DM Sans',sans-serif", outline: 'none', background: '#FAFAF8', boxSizing: 'border-box', marginBottom: 12 }}
            />
            <button
              onClick={() => { setShowPasswordModal(false); processFile(pdfPassword); }}
              disabled={!pdfPassword}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                background: pdfPassword ? 'linear-gradient(135deg, #5B2D8E, #7B4DB8)' : '#D0CAC0',
                color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: pdfPassword ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans',sans-serif",
              }}>Confirmar e Processar</button>
            <button onClick={() => { setShowPasswordModal(false); setIsEncrypted(false); setPdfPassword(''); }} style={{
              width: '100%', padding: '10px 0', marginTop: 8, borderRadius: 12, border: 'none',
              background: 'none', color: '#AAA', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
            }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ═══ UPLOAD STEP ═══ */}
      {step === 'upload' && (
        <div style={{ padding: '48px 20px 40px' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🔍</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 6 }}>
              <h1 style={{ fontFamily: "'Source Serif 4',serif", fontSize: 26, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
                Validador de Prompt
              </h1>
              <span style={{ background: '#5B2D8E', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '3px 9px', letterSpacing: 0.3 }}>v2 — App</span>
            </div>
            <p style={{ fontSize: 13, color: '#888', margin: 0, lineHeight: 1.5 }}>
              Prompt exato do app. Suba uma apólice, a AI extrai os dados, e você avalia campo a campo.
            </p>
          </div>

          {/* Settings toggle */}
          <button onClick={() => setShowSettings(!showSettings)} style={{
            width: '100%', padding: '12px 16px', borderRadius: 14, border: '1px solid #E0DCD5',
            background: '#fff', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>⚙️ Configurações da AI</span>
            <span style={{ fontSize: 12, color: '#888' }}>{PROVIDERS[provider].label} • {model}</span>
          </button>

          {showSettings && (
            <div style={{ background: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, border: '1px solid #F0EDE8' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#888', display: 'block', marginBottom: 6 }}>PROVIDER</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {Object.entries(PROVIDERS).map(([key, p]) => (
                  <button key={key} onClick={() => handleProviderChange(key)} style={{
                    flex: 1, padding: '10px 4px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                    border: provider === key ? '2px solid #5B2D8E' : '1.5px solid #E0DCD5',
                    background: provider === key ? '#F3EEFB' : '#FAFAF8',
                    color: provider === key ? '#5B2D8E' : '#888',
                    cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
                  }}>{p.label.split(' ')[0]}</button>
                ))}
              </div>

              <label style={{ fontSize: 12, fontWeight: 600, color: '#888', display: 'block', marginBottom: 6 }}>MODELO</label>
              <select value={model} onChange={(e) => setModel(e.target.value)} style={{
                width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E0DCD5',
                fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: '#FAFAF8', marginBottom: 14, outline: 'none',
              }}>
                {PROVIDERS[provider].models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>

              <input type="text" placeholder="Ou digite um modelo customizado..." value={PROVIDERS[provider].models.includes(model) ? '' : model}
                onChange={(e) => { if (e.target.value) setModel(e.target.value); }}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E0DCD5', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: '#FAFAF8', marginBottom: 14, outline: 'none' }}
              />

              <label style={{ fontSize: 12, fontWeight: 600, color: '#888', display: 'block', marginBottom: 6 }}>API KEY</label>
              <input type="password" placeholder="sk-... ou AIza..." value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E0DCD5', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: '#FAFAF8', outline: 'none' }}
              />
              <p style={{ fontSize: 11, color: '#AAA', margin: '6px 0 0' }}>A key fica salva apenas no seu navegador (localStorage).</p>

              <div style={{ height: 1, background: '#F0EDE8', margin: '18px 0' }} />

              <label style={{ fontSize: 12, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>SUPABASE — SALVAR FEEDBACKS</label>
              <p style={{ fontSize: 11, color: '#AAA', margin: '0 0 10px', lineHeight: 1.5 }}>
                Cole a URL e a chave anon do seu projeto Supabase para salvar cada avaliação automaticamente como uma linha no banco.
              </p>
              <input type="text" placeholder="https://xxxx.supabase.co" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value.trim())}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E0DCD5', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: '#FAFAF8', marginBottom: 8, outline: 'none', boxSizing: 'border-box' }}
              />
              <input type="password" placeholder="anon key (eyJ...)" value={supabaseKey} onChange={(e) => setSupabaseKey(e.target.value.trim())}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E0DCD5', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: '#FAFAF8', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          )}

          <input ref={fileRef} type="file" accept=".pdf" onChange={handleFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{
            width: '100%', padding: '44px 20px', borderRadius: 20, border: '2px dashed #D0CAC0',
            background: fileName ? '#F0EDE8' : '#FAFAF8', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
            transition: 'all 0.2s ease', marginBottom: 12,
          }}>
            {fileName ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A' }}>{fileName}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Toque para trocar</div>
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📤</div>
                <div style={{ fontSize: 14, color: '#888' }}>Toque para selecionar o PDF</div>
              </div>
            )}
          </button>

          {error && (
            <div style={{ background: '#FFEBEE', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              {error.startsWith('PARSE_ERROR|||') ? (() => {
                const [, detail, snippet] = error.split('|||');
                return <>
                  <div style={{ fontSize: 13, color: '#C62828', marginBottom: 8 }}>❌ JSON não pôde ser corrigido automaticamente: {detail}</div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Response da IA (primeiros 600 chars):</div>
                  <pre style={{ fontSize: 10, color: '#555', background: '#fff', borderRadius: 8, padding: 8, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, margin: 0 }}>{snippet}</pre>
                </>;
              })() : <span style={{ fontSize: 13, color: '#C62828' }}>❌ {error}</span>}
            </div>
          )}

          <button onClick={() => processFile()} disabled={!fileData || !apiKey || loading} style={{
            width: '100%', padding: '16px 0', borderRadius: 14, border: 'none',
            background: fileData && apiKey && !loading ? 'linear-gradient(135deg, #5B2D8E, #7B4DB8)' : '#D0CAC0',
            color: '#fff', fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans',sans-serif",
            cursor: fileData && apiKey && !loading ? 'pointer' : 'not-allowed', transition: 'all 0.2s ease',
          }}>
            {loading ? `⏳ Processando... (${elapsedTime}s)` : '🚀 Processar Apólice'}
          </button>

          {loading && (
            <div style={{ marginTop: 14, padding: 14, background: '#fff', borderRadius: 12, border: '1px solid #F0EDE8', textAlign: 'center' }}>
              <div style={{ width: '100%', height: 4, background: '#F0EDE8', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', background: 'linear-gradient(90deg, #5B2D8E, #7B4DB8)', borderRadius: 2, width: '30%', animation: 'loadBar 1.8s ease-in-out infinite' }} />
              </div>
              <span style={{ fontSize: 13, color: '#888' }}>{loadingMsg}</span>
              <style>{`@keyframes loadBar { 0% { transform: translateX(-100%); } 100% { transform: translateX(430%); } }`}</style>
            </div>
          )}
        </div>
      )}

      {/* ═══ EVALUATE STEP ═══ */}
      {step === 'evaluate' && r && (
        <div>
          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg, #5B2D8E, #7B4DB8)', padding: '40px 20px 20px', color: '#fff' }}>
            <button onClick={() => { setStep('upload'); setResult(null); setHasSaved(false); setSaveStatus(null); }} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, cursor: 'pointer', opacity: 0.8, fontFamily: "'DM Sans',sans-serif", marginBottom: 10 }}>
              ← Nova apólice
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontFamily: "'Source Serif 4',serif", fontSize: 22, fontWeight: 700, margin: 0 }}>Avaliação de Extração</h1>
              <span style={{ background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '3px 9px', letterSpacing: 0.3 }}>v2 — App</span>
            </div>
            <p style={{ fontSize: 13, opacity: 0.8, margin: '0 0 4px' }}>{r.nomeSeguradora}</p>
            <p style={{ fontSize: 11, opacity: 0.6, margin: 0 }}>{PROVIDERS[provider].label} • {model} • {elapsedTime}s</p>

            <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
              {[
                { l: 'Avaliados', v: stats.total, bg: 'rgba(255,255,255,0.15)' },
                { l: 'Corretos', v: stats.correct, bg: 'rgba(76,175,80,0.25)' },
                { l: 'Errados', v: stats.wrong, bg: 'rgba(198,40,40,0.25)' },
                { l: 'Faltando', v: stats.missing, bg: 'rgba(230,81,0,0.25)' },
              ].map((s, i) => (
                <div key={i} style={{ flex: 1, background: s.bg, borderRadius: 10, padding: '8px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{s.v}</div>
                  <div style={{ fontSize: 10, opacity: 0.8 }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '12px 16px' }}>
            {r.__warning__ && (
              <div style={{ background: '#FFF3E0', border: '1px solid #FFCC80', borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#E65100', fontWeight: 600, marginBottom: 6 }}>⚠️ Extração incompleta</div>
                <div style={{ fontSize: 12, color: '#BF360C' }}>{r.__warning__}</div>
              </div>
            )}

            {rawResponse && (
              <details style={{ marginBottom: 14 }}>
                <summary style={{ fontSize: 12, color: '#888', cursor: 'pointer', padding: '8px 0' }}>
                  🔍 Ver resposta bruta da IA ({rawResponse.length} chars)
                </summary>
                <pre style={{ fontSize: 10, color: '#555', background: '#fff', border: '1px solid #F0EDE8', borderRadius: 10, padding: 10, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, margin: '6px 0 0' }}>{rawResponse.substring(0, 3000)}{rawResponse.length > 3000 ? `\n\n…(${rawResponse.length - 3000} chars omitidos)` : ''}</pre>
              </details>
            )}

            {/* Legend */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
              {[
                { i: '○', l: 'Não avaliado', bg: '#F5F3EE' }, { i: '✓', l: 'Correto', bg: '#E8F5E9' },
                { i: '✗', l: 'Errado', bg: '#FFEBEE' }, { i: '?', l: 'Faltando', bg: '#FFF3E0' },
              ].map((x, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, background: x.bg, borderRadius: 8, padding: '3px 8px' }}>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{x.i}</span>
                  <span style={{ fontSize: 11, color: '#555' }}>{x.l}</span>
                </div>
              ))}
            </div>

            <p style={{ fontSize: 12, color: '#999', margin: '0 0 12px', lineHeight: 1.4 }}>
              Clique ○ para rotacionar: ✓ correto → ✗ errado → ? faltando. Use 💬 para comentar.
            </p>

            {/* Apólice & Seguradora */}
            <Section title="Apólice & Seguradora" icon="🏢" defaultOpen>
              <EvalRow label="Seguradora" value={r.nomeSeguradora} fieldPath="nomeSeguradora" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Nº Apólice" value={r.numeroApolice} fieldPath="numeroApolice" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Classe Bônus" value={r.classeBonus} fieldPath="classeBonus" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Vigência Início" value={r.dataInicio} fieldPath="dataInicio" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Vigência Fim" value={r.dataFim} fieldPath="dataFim" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Prêmio Total" value={fmt(r.valor)} fieldPath="valor" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
            </Section>

            {/* Segurado */}
            <Section title="Segurado" icon="👤" defaultOpen>
              <EvalRow label="Nome" value={r.nomeSegurado} fieldPath="nomeSegurado" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Telefone" value={r.telefoneSegurado} fieldPath="telefoneSegurado" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Email" value={r.emailSegurado} fieldPath="emailSegurado" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Data de Nascimento" value={r.dataNascimentoSegurado} fieldPath="dataNascimentoSegurado" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Gênero" value={r.generoSegurado} fieldPath="generoSegurado" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Endereço" value={[r.logradouro, r.bairro, r.cidade, r.estado, r.cep].filter(Boolean).join(', ')} fieldPath="endereco" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
            </Section>

            {/* Condutor Principal */}
            <Section title="Condutor Principal" icon="🪪">
              <EvalRow label="Nome" value={r.condutorPrincipal?.nome} fieldPath="condutor.nome" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              {r.condutorPrincipal?.dataNascimento
                ? <EvalRow label="Data de Nascimento" value={r.condutorPrincipal.dataNascimento} fieldPath="condutor.dataNascimento" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
                : <EvalRow label="Idade" value={r.condutorPrincipal?.idade != null ? `${r.condutorPrincipal.idade} anos` : null} fieldPath="condutor.idade" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              }
              <EvalRow label="Gênero" value={r.condutorPrincipal?.genero} fieldPath="condutor.genero" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Estado Civil" value={r.condutorPrincipal?.estadoCivil} fieldPath="condutor.estadoCivil" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Vínculo com Segurado" value={r.condutorPrincipal?.vinculoSegurado} fieldPath="condutor.vinculo" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="É o Segurado?" value={r.condutorPrincipal?.eOSegurado} fieldPath="condutor.eOSegurado" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
            </Section>

            {/* Veículo */}
            <Section title="Veículo" icon="🚗" defaultOpen>
              <EvalRow label="Marca" value={r.marcaVeiculo} fieldPath="marcaVeiculo" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Modelo" value={r.modeloVeiculo} fieldPath="modeloVeiculo" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Ano Fabricação / Modelo" value={`${r.anoFabricacao || '?'} / ${r.anoModelo || '?'}`} fieldPath="anoFabricacao" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Placa" value={r.placa} fieldPath="placa" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Chassi" value={r.chassi} fieldPath="chassi" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Código FIPE" value={r.codigoFipe} fieldPath="codigoFipe" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Combustível" value={r.combustivel} fieldPath="combustivel" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Uso" value={r.usoVeiculo} fieldPath="usoVeiculo" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Categoria" value={r.categoriaVeiculo} fieldPath="categoriaVeiculo" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Lotação" value={r.lotacao} fieldPath="lotacao" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="CEP Pernoite" value={r.cepPernoite} fieldPath="cepPernoite" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
            </Section>

            {/* Coberturas Contratadas */}
            <Section title="Coberturas Contratadas" icon="🛡️" badge={r.coberturasContratadas?.length || 0} defaultOpen>
              {(r.coberturasContratadas || []).map((c, i) => (
                <div key={i} style={{ background: '#FAFAF8', borderRadius: 12, padding: 12, marginBottom: 8, border: '1px solid #F0EDE8' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <FeedbackBtn status={feedbacks[`cob.${i}`]?.status || 'none'} onToggle={toggleFeedback} fieldPath={`cob.${i}`} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>{c.nome}</div>
                      {c.descricao && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{c.descricao}</div>}
                      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                        <div><span style={{ fontSize: 10, color: '#AAA' }}>LMI</span><br /><span style={{ fontSize: 12, color: '#555' }}>{c.lmi || '—'}</span></div>
                        <div><span style={{ fontSize: 10, color: '#AAA' }}>Prêmio</span><br /><span style={{ fontSize: 12, color: '#5B2D8E', fontWeight: 600 }}>{fmt(c.premio)}</span></div>
                      </div>
                    </div>
                  </div>
                  {(feedbacks[`cob.${i}`]?.status === 'wrong' || feedbacks[`cob.${i}`]?.status === 'missing') && (
                    <input type="text" placeholder="O que está errado/faltando?" value={feedbacks[`cob.${i}`]?.comment || ''}
                      onChange={(e) => setComment(`cob.${i}`, e.target.value)}
                      style={{ width: '100%', marginTop: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid #E0DCD5', fontSize: 12, fontFamily: "'DM Sans',sans-serif", background: '#fff' }} />
                  )}
                </div>
              ))}
              {(!r.coberturasContratadas || r.coberturasContratadas.length === 0) && (
                <p style={{ fontSize: 13, color: '#AAA', margin: 0 }}>Nenhuma cobertura extraída.</p>
              )}
            </Section>

            {/* Franquias */}
            <Section title="Franquias" icon="💰" badge={r.franquias?.length || 0} defaultOpen>
              {(r.franquias || []).map((f, i) => (
                <div key={i} style={{ borderBottom: '1px solid #F0EDE8' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 0' }}>
                    <FeedbackBtn status={feedbacks[`franq.${i}`]?.status || 'none'} onToggle={toggleFeedback} fieldPath={`franq.${i}`} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>{f.nome}</span>
                      {f.descricao && <span style={{ fontSize: 11, color: '#888', display: 'block', marginTop: 2 }}>{f.descricao}</span>}
                      <span style={{ fontSize: 13, color: '#C62828', fontWeight: 600, display: 'block', marginTop: 2 }}>{fmt(f.valor)}</span>
                    </div>
                  </div>
                  {(feedbacks[`franq.${i}`]?.status === 'wrong' || feedbacks[`franq.${i}`]?.status === 'missing') && (
                    <input type="text" placeholder="Correção..." value={feedbacks[`franq.${i}`]?.comment || ''}
                      onChange={(e) => setComment(`franq.${i}`, e.target.value)}
                      style={{ width: '100%', marginBottom: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid #E0DCD5', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }} />
                  )}
                </div>
              ))}
              {(!r.franquias || r.franquias.length === 0) && (
                <p style={{ fontSize: 13, color: '#AAA', margin: 0 }}>Nenhuma franquia extraída.</p>
              )}
            </Section>

            {/* Serviços Adicionais */}
            <Section title="Serviços Adicionais" icon="🔧" badge={r.servicosAdicionais?.length || 0}>
              {(r.servicosAdicionais || []).map((s, i) => (
                <div key={i} style={{ borderBottom: '1px solid #F0EDE8', paddingBottom: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <FeedbackBtn status={feedbacks[`svc.${i}`]?.status || 'none'} onToggle={toggleFeedback} fieldPath={`svc.${i}`} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{s.nome} {s.premio ? `— ${fmt(s.premio)}` : ''}</div>
                      {s.detalhes && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{s.detalhes}</div>}
                    </div>
                  </div>
                  {(feedbacks[`svc.${i}`]?.status === 'wrong' || feedbacks[`svc.${i}`]?.status === 'missing') && (
                    <input type="text" placeholder="Correção..." value={feedbacks[`svc.${i}`]?.comment || ''} onChange={(e) => setComment(`svc.${i}`, e.target.value)}
                      style={{ width: '100%', marginTop: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid #E0DCD5', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }} />
                  )}
                </div>
              ))}
              {(!r.servicosAdicionais || r.servicosAdicionais.length === 0) && (
                <p style={{ fontSize: 13, color: '#AAA', margin: 0 }}>Nenhum serviço adicional extraído.</p>
              )}
            </Section>

            {/* Pagamento */}
            <Section title="Pagamento" icon="💳">
              <EvalRow label="Prêmio Líquido" value={fmt(r.pagamento?.premioLiquido)} fieldPath="pag.premioLiquido" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="IOF" value={fmt(r.pagamento?.iof)} fieldPath="pag.iof" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Prêmio Total" value={fmt(r.pagamento?.premioTotal)} fieldPath="pag.premioTotal" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Forma de Pagamento" value={r.pagamento?.formaPagamento} fieldPath="pag.formaPagamento" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              <EvalRow label="Parcelas" value={r.pagamento?.parcelas && r.pagamento?.valorParcela ? `${r.pagamento.parcelas}x de ${fmt(r.pagamento.valorParcela)}` : r.pagamento?.parcelas} fieldPath="pag.parcelas" feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
            </Section>

            {/* Outras Informações */}
            <Section
              title="Outras Informações"
              icon="📌"
              warningBanner="⚠️ Esta seção não estará no app — serve apenas para capturar dados que ainda não têm um campo mapeado e podem precisar ser realocados no processo de refinamento."
            >
              {(r.outrasInformacoes?.observacoes || []).map((obs, i) => (
                <EvalRow key={i} label={`Observação ${i + 1}`} value={obs} fieldPath={`out.obs.${i}`} feedbacks={feedbacks} onToggle={toggleFeedback} onComment={setComment} />
              ))}
              {(!r.outrasInformacoes?.observacoes || r.outrasInformacoes.observacoes.length === 0) && (
                <p style={{ fontSize: 13, color: '#AAA', margin: 0 }}>Nenhuma observação adicional.</p>
              )}
            </Section>

            {/* Notas gerais */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, border: '1px solid #F0EDE8' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A', marginBottom: 8 }}>📝 Notas gerais</div>
              <textarea placeholder="Observações gerais sobre a extração..." value={generalNotes} onChange={(e) => setGeneralNotes(e.target.value)}
                rows={4} style={{ width: '100%', padding: 12, borderRadius: 10, border: '1.5px solid #E0DCD5', fontSize: 13, fontFamily: "'DM Sans',sans-serif", resize: 'vertical', background: '#FAFAF8', outline: 'none' }} />
            </div>

            {/* Save / Export */}
            <button
              onClick={saveFeedback}
              disabled={saveStatus === 'saving' || hasSaved}
              style={{
                width: '100%', padding: '16px 0', borderRadius: 14, border: 'none',
                background: saveStatus === 'saved'
                  ? 'linear-gradient(135deg, #2E7D32, #43A047)'
                  : saveStatus && saveStatus !== 'saving' && saveStatus !== 'saved'
                  ? '#C62828'
                  : saveStatus === 'saving'
                  ? '#9E9E9E'
                  : 'linear-gradient(135deg, #5B2D8E, #7B4DB8)',
                color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
                fontFamily: "'DM Sans',sans-serif", marginBottom: 8, transition: 'background 0.3s ease',
              }}>
              {saveStatus === 'saving' && '⏳ Salvando...'}
              {saveStatus === 'saved' && (supabaseUrl ? '✅ Salvo no banco e baixado!' : '✅ Arquivo baixado!')}
              {saveStatus && saveStatus !== 'saving' && saveStatus !== 'saved' && `❌ ${saveStatus}`}
              {!saveStatus && `💾 Salvar Feedback (${stats.total} avaliados)`}
            </button>
            <p style={{ fontSize: 11, color: '#AAA', textAlign: 'center', margin: '-2px 0 40px', lineHeight: 1.5 }}>
              {supabaseUrl
                ? 'Salva o arquivo .json no Supabase Storage — baixe quando quiser'
                : 'Sem Supabase configurado — o arquivo será baixado localmente'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
