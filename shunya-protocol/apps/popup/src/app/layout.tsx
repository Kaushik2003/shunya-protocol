import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Shunya Verify',
  description: 'Shunya verification popup'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

