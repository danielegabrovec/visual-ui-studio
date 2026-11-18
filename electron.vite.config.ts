import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@codegen': resolve(__dirname, 'src/workers/codegen-worker'),
      },
    },
    build: {
      rollupOptions: {
        external: ['node:sqlite'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'workers/db-worker': resolve(__dirname, 'src/workers/db-worker/index.ts'),
          'workers/codegen-worker': resolve(__dirname, 'src/workers/codegen-worker/index.ts'),
          'workers/ai-worker': resolve(__dirname, 'src/workers/ai-worker/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@codegen': resolve(__dirname, 'src/workers/codegen-worker'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
