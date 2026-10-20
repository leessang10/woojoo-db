import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname.replace(/^\/(\w:)/, "$1") } },
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: { rollupOptions: { output: { manualChunks: { editor: ['@uiw/react-codemirror', '@codemirror/lang-sql', '@codemirror/theme-one-dark'] } } } },
});
