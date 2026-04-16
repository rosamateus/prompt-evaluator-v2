/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // pdfjs-dist v5 inclui webpack runtime interno — precisa ignorar o canvas
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
