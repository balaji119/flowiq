import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ADS Connect',
  description: 'Campaign scheduling and PrintIQ quote workflow',
  icons: {
    icon: [{ url: '/ads-logo.webp', type: 'image/webp' }],
    shortcut: '/ads-logo.webp',
    apple: '/ads-logo.webp',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
