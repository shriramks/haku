import type { Metadata, Viewport } from 'next'
import './globals.css'
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar'
import BottomNav from '@/components/BottomNav'
import { getAllStockSymbols } from '@/lib/data'

export const metadata: Metadata = {
  title: 'Haku',
  description: 'Personal Indian stock portfolio tracker',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico',    sizes: 'any' },
      { url: '/icon.svg',       type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Haku',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F2F2F7' },
    { media: '(prefers-color-scheme: dark)',  color: '#000000' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Fetched once here rather than in BottomNav itself — the root layout doesn't re-run on
  // client-side navigation, so this is one server-side read per full page load instead of
  // a client-side Supabase round trip on every mount (see progress_haku.md #134/#135).
  const planSymbols = await getAllStockSymbols()

  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="format-detection" content="telephone=no" />
        {/* Hardcoded script — no user input; applies saved theme before paint to prevent flash */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('haku-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body>
        <ServiceWorkerRegistrar />
        <div aria-hidden className="ios-status-strip" />
        {children}
        <BottomNav planSymbols={planSymbols} />
      </body>
    </html>
  )
}
