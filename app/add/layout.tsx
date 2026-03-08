import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Add Trade',
  manifest: '/manifest-add.json',
  appleWebApp: {
    capable: true,
    title: 'Add Trade',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    apple: '/icon-add.svg',
  },
}

export default function AddLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
