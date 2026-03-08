import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Add Trade',
  other: {
    'apple-mobile-web-app-title': 'Add Trade',
  },
}

export default function AddLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
