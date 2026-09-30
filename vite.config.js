import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadEnvFile } from './lib/load-env.js';

loadEnvFile();

const apiPort = Number(process.env.PORT) || 3000;

/** 生产构建：去掉 head 里三张装饰图的 preload，避免与入口 JS/CSS/modulepreload 争抢带宽与连接 */
function prodStripImagePreloads() {
  return {
    name: 'prod-strip-image-preloads',
    transformIndexHtml(html) {
      if (process.env.NODE_ENV !== 'production') return html;
      return html
        .replace(/<link rel="preload" href="\/images\/cd\.webp"[^>]*>\s*/g, '')
        .replace(/<link rel="preload" href="\/images\/cd_tou\.webp"[^>]*>\s*/g, '')
        .replace(/<link rel="preload" href="\/images\/background\.webp"[^>]*>\s*/g, '');
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), prodStripImagePreloads()],
    base: '/',
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
          },
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  };
});
