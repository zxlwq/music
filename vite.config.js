import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    build: { outDir: 'dist' },
    define: {
      'import.meta.env.VITE_GIT_REPO': JSON.stringify(env.VITE_GIT_REPO || env.GIT_REPO || ''),
      'import.meta.env.VITE_GIT_TOKEN': JSON.stringify(env.VITE_GIT_TOKEN || env.GIT_TOKEN || ''),
      'import.meta.env.VITE_GIT_BRANCH': JSON.stringify(env.VITE_GIT_BRANCH || env.GIT_BRANCH || 'main')
    }
  }
})


