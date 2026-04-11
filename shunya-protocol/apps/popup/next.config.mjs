/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // Allow snarkjs WASM modules to be imported by Next.js
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    // Suppress canvas warning from pdfjs-dist
    config.resolve.alias['canvas'] = false;
    return config;
  },
};

export default nextConfig;

