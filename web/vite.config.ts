import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

// The browser app. Built into ../dist, which the Worker serves (see wrangler.jsonc).
export default defineConfig({
  plugins: [react(), mkcert()],
  base: '/',
  build: { outDir: '../dist', emptyOutDir: true },
});
