# Validador de Prompt — Extração de Apólices

Ferramenta interna para avaliar a qualidade da extração de dados de apólices de seguro via AI.

## Como funciona

1. O especialista sobe um PDF de apólice
2. A AI (Anthropic/OpenAI/Google) processa e extrai os dados em JSON
3. O especialista avalia campo a campo: ✓ correto, ✗ errado, ? faltando
4. Exporta o feedback como JSON para refinar o prompt

## Deploy na Vercel

### Opção 1 — Via GitHub (recomendado)

```bash
# 1. Crie um repo no GitHub e suba os arquivos
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/SEU_USER/prompt-evaluator.git
git push -u origin main

# 2. Vá em vercel.com → New Project → Import o repo → Deploy
```

### Opção 2 — Via Vercel CLI

```bash
# 1. Instale a Vercel CLI
npm i -g vercel

# 2. Na pasta do projeto, rode:
vercel

# 3. Siga as instruções (aceite os defaults)
```

## Configuração

Não precisa de variáveis de ambiente. A API key é configurada direto no frontend pelo usuário e salva no localStorage do navegador dele.

## Providers suportados

- **Anthropic** — Claude Sonnet 4, Opus 4, Haiku 4.5
- **OpenAI** — GPT-4o, GPT-4o-mini, GPT-4.1, o4-mini
- **Google** — Gemini 2.5 Flash, 2.5 Pro, 2.0 Flash

Também aceita modelo customizado digitando manualmente.

## JSON de Feedback exportado

```json
{
  "arquivo": "apolice-zurich.pdf",
  "provider": "anthropic",
  "modelo": "claude-sonnet-4-20250514",
  "tempo_processamento_segundos": 12,
  "seguradora": "Zurich",
  "apolice": "0563614",
  "notas_gerais": "Texto livre do avaliador",
  "avaliacoes": [
    { "campo": "franq.v.parabrisa", "status": "wrong", "comentario": "No PDF é R$ 580" },
    { "campo": "cob.3", "status": "missing", "comentario": "Faltou APP Morte" }
  ],
  "estatisticas": {
    "total": 35,
    "corretos": 31,
    "errados": 2,
    "faltando": 2
  },
  "json_extraido": { ... }
}
```
