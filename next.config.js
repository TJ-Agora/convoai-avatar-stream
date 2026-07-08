/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Expose AGORA_APP_ID to the client so we don't need a duplicate NEXT_PUBLIC_ var
    NEXT_PUBLIC_AGORA_APP_ID: process.env.AGORA_APP_ID,
  },
}

module.exports = nextConfig
