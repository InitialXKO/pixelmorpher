import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Vercel handles output automatically; "standalone" is for Docker/self-host only
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Set correct headers for ORT WASM and SAM worker files
  async headers() {
    return [
      {
        source: "/ort-wasm/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/sam-worker/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
