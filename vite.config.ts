import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';
import Icons from 'unplugin-icons/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), mkcert(), Icons({ compiler: 'jsx', jsx: 'react' })],
  base: '/splitfoolish/',
});
