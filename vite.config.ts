import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 로컬 개발: /api 요청을 core(기본 localhost:8080)로 넘긴다.
// infra compose로 띄웠으면 core 포트가 안 열려 있으니 입구로 보낸다: VITE_API_TARGET=http://localhost:8411 npm run dev
// 서버에서는 앞단 nginx가 /api → core, 나머지 → 이 앱으로 나눈다.
// 비서(agent)를 따로 띄웠으면 VITE_AGENT_TARGET=http://localhost:8091 로 /api/agent만 그쪽으로 보낸다.
// 서버에서는 게이트웨이가 /api/agent/** → agent로 나눈다.
function proxies(env: Record<string, string>): Record<string, string> {
  const core = env.VITE_API_TARGET || 'http://localhost:8080'
  return env.VITE_AGENT_TARGET ? { '/api/agent': env.VITE_AGENT_TARGET, '/api': core } : { '/api': core }
}

export default defineConfig(({ mode }) => ({
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
    proxy: proxies(loadEnv(mode, '.', 'VITE_')),
  },
  test: {
    environment: 'node',
  },
}))
