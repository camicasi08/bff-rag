import type { Metadata } from 'next';
import { Manrope, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
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
      <body className={`${manrope.variable} ${spaceGrotesk.variable}`}>
        {children}
      </body>
    </html>
  );
}
