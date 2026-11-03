import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 로컬 개발: /api 요청을 core(localhost:8080)로 넘긴다.
// 서버에서는 앞단 nginx가 /api → core, 나머지 → 이 앱으로 나눈다.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'M-space 예약',
        short_name: 'M-space',
        description: 'IT융합대학 M-space 창작실 예약',
        lang: 'ko',
        theme_color: '#0A4DA2',
        background_color: '#EEF1F5',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // API 응답은 캐시하지 않는다(예약 현황은 늘 최신이어야 함)
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'node',
  },
})
