import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'TrainerPro — ניהול מתאמנים',
        short_name: 'TrainerPro',
        description: 'מערכת ניהול מלאה למאמני כושר',
        theme_color: '#f4f6fb',
        background_color: '#f4f6fb',
        display: 'standalone',
        orientation: 'any',
        lang: 'he',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        categories: ['health', 'fitness', 'productivity', 'business'],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff,woff2}'],
        // אין מטמון לבקשות חיצוניות: המודול לא פונה לרשת (SuperSuite, כלל 6)
        runtimeCaching: []
      }
    })
  ],
  // הבנייה יוצאת ל-dist; tools/build-trainer.js מעתיק ל-modules/trainer ושומר את קבצי השילוב
  // (preload.js, suite-theme.css) — ראו README-SUPERSUITE.md
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    host: true,
    port: 5173
  }
});
