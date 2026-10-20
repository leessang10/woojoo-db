import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: { rollupOptions: { output: { manualChunks: { editor: ['@uiw/react-codemirror', '@codemirror/lang-sql', '@codemirror/theme-one-dark'] } } } },
});
