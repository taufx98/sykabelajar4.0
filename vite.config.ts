import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@/data/demo',
        replacement: fileURLToPath(new URL('./src/data/live.ts', import.meta.url)),
      },
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
    ],
  },
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'styles.min.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
