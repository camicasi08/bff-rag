import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'BFF RAG Studio',
  description: 'Admin and chat workspace for the local BFF + RAG stack.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={manrope.variable}>
        {children}
      </body>
    </html>
  );
}
