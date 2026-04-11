// Runtime environment — substituted by Docker entrypoint before nginx starts.
// RUNTIME_API_URL is replaced with the actual API_URL env var at container start.
//
// In local dev (npm run dev) this file is served as-is with the literal
// placeholder; client.ts detects the placeholder and falls back to
// import.meta.env.VITE_API_URL instead.
window._env = { API_URL: 'RUNTIME_API_URL' };
