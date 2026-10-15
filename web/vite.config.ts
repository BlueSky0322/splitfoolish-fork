import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';
import { fileURLToPath } from 'node:url';

// The browser app. Built into ../dist, which the Worker serves (see wrangler.jsonc).
export default defineConfig({
  plugins: [react(), mkcert()],
  base: '/',
  // The same as web/tsconfig.json's paths
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  build: { outDir: '../dist', emptyOutDir: true },
});
