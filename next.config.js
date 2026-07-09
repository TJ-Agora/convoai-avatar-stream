/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Verification builds set NEXT_DIST_DIR (e.g. ".next-verify") so they never
  // clobber the running dev server's .next — a shared dir causes webpack-cache
  // ENOENT noise and unhandledRejections in the dev console. Unset (dev,
  // Vercel) this is the default ".next".
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: {
    // Expose AGORA_APP_ID to the client so we don't need a duplicate NEXT_PUBLIC_ var
    NEXT_PUBLIC_AGORA_APP_ID: process.env.AGORA_APP_ID,
  },
}

module.exports = nextConfig
