import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EXPRESS_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3000';

// Baked-in app version for the footer: the packaging build sets package.json's
// version from the release tag (create-a-container/Makefile `build`); dev
// builds keep 0.0.0, which the UI renders as a development build.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Use a regex so /api/* is proxied but client routes like /apikeys are not.
      '^/api(/|$)': { target: EXPRESS_TARGET, changeOrigin: false, secure: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
