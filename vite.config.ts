import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // The API server (npm run server) handles accounts, classrooms and the AI tutor.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
