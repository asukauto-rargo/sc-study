import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages ではリポジトリ名がパスに入るため base を付ける。
// ローカル開発や別ホストに出すときは VITE_BASE=/ を指定する。
export default defineConfig({
  base: process.env.VITE_BASE ?? '/sc-study/',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
