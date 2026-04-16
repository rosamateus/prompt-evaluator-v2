/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['pdfjs-dist'],
  // Evita que o webpack bundle o pdf-parse — ele precisa do module.parent do Node.js
  // para não entrar em modo de debug (que tenta ler arquivos de teste inexistentes no Vercel)
  serverExternalPackages: ['pdf-parse'],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
