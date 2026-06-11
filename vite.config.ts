import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages가 https://moriochoradio.github.io/tarkov-companion/ 하위 경로에
// 배포되므로 base를 리포 이름으로 맞춰야 JS/CSS 경로가 깨지지 않음
export default defineConfig({
  base: '/tarkov-companion/',
  plugins: [react()],
})
