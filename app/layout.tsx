import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: "Boldo AI",
  description: "The AI assistant for your team",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-visual',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL!} />
        <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL!} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
