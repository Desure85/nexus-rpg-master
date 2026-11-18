import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

/** Демо: окружение «сервера» задаётся инлайн-скриптом раньше любых модулей. */
const demoEnvPlugin = () => ({
  name: 'nexus-demo-env',
  transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    <script>${fs.readFileSync(path.resolve(__dirname, 'demo/env.js'), 'utf8')}</script>`),
});

// ВАЖНО: никаких секретов в define — всё, что попадает сюда, видно в браузере.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const r = (p: string) => path.resolve(__dirname, p);
  return {
    // демо публикуется на GitHub Pages: https://<user>.github.io/<repo>/
    base: demo ? (process.env.DEMO_BASE || '/nexus-rpg-master/') : '/',
    plugins: [react(), tailwindcss(), ...(demo ? [demoEnvPlugin()] : [])],
    // серверный код читает process.env: в демо это объект, заполняемый до загрузки модулей (demo/env.js)
    define: demo ? { 'import.meta.env.VITE_DEMO': JSON.stringify('1'), 'process.env': 'globalThis.__nexusEnv' } : {},
    resolve: {
      alias: [
        { find: '@', replacement: r('.') },
        { find: 'virtual:nexus-transport', replacement: demo ? r('demo/client.ts') : r('demo/transport-stub.ts') },
        // демо: серверный код в браузере — подменяем Node-зависимости
        ...(demo ? [
          { find: 'better-sqlite3', replacement: r('demo/shims/better-sqlite3.ts') },
          { find: /^\.\/crypto$/, replacement: r('demo/shims/app-crypto.ts') },
          { find: /^(node:)?crypto$/, replacement: r('demo/shims/node-crypto.ts') },
          { find: /^(node:)?fs$/, replacement: r('demo/shims/fs.ts') },
          { find: /^(node:)?path$/, replacement: r('demo/shims/path.ts') },
          { find: '@google/genai', replacement: r('demo/shims/empty.ts') },
          { find: 'nodemailer', replacement: r('demo/shims/empty.ts') },
        ] : []),
      ],
    },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
            if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'motion';
            if (id.includes('node_modules/d3')) return 'd3';
            // демо: серверная часть грузится отдельно и только в ведущей вкладке
            if (demo && (id.includes('/server/') || id.includes('/demo/shims/') || id.includes('node_modules/sql.js'))) return 'demo-server';
            return undefined;
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
