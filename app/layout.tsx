import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FlowIQ',
  description: 'Campaign scheduling and PrintIQ quote workflow',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
