import { Instrument_Serif, Space_Grotesk, JetBrains_Mono, Inter } from 'next/font/google';
import './globals.css';

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

// Brand-pack face (thredUP's grotesque body type). Fonts are per-deployment,
// so it's always loaded; only the [data-brand="thredup"] block references it.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-thredup',
  display: 'swap',
});

export const metadata = {
  title: 'AI Avatar Stream',
  description: 'A 1-to-many live room with a conversational AI avatar host.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} ${spaceGrotesk.variable} ${jetbrains.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
