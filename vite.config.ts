import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// base './' so the build works on GitHub Pages under /<repo>/ or on a custom domain
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
