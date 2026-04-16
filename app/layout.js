export const metadata = {
  title: 'Validador de Prompt — Extração de Apólices',
  description: 'Ferramenta para avaliar a extração de dados de apólices de seguro via AI',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Source+Serif+4:wght@600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, background: '#F7F4EF' }}>{children}</body>
    </html>
  )
}
