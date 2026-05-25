import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, proxy API/auth calls to the Express server (npm start) on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
});
