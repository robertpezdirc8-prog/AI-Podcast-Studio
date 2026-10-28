import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  /* metadataBase (Task 61): absolutizacija OG/Twitter URL-jev brez opozorila;
     produkcija nastavi NEXT_PUBLIC_APP_URL, sicer ostane localhost. */
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "AI Podcast Studio",
  description:
    "Ustvari profesionalni dvogostiteljski podcast iz skripte ali teme — AI glasovi (Rok & Petra), karaoke predvajalnik, poglavja, zapiski in izvozi MP3/MP4/RSS.",
  keywords: [
    "podcast",
    "podkast",
    "AI",
    "TTS",
    "slovenščina",
    "studioski posnetek",
    "RSS",
  ],
  authors: [{ name: "AI Podcast Studio" }],
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-512.png",
  },
  openGraph: {
    title: "AI Podcast Studio",
    description:
      "Iz skripte do zvočnega podkasta — AI glasova Rok & Petra, karaoke predvajalnik in izvozi MP3/MP4/RSS.",
    images: ["/og.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Podcast Studio",
    description:
      "Iz skripte do zvočnega podkasta — AI glasova Rok & Petra, karaoke predvajalnik in izvozi MP3/MP4/RSS.",
    images: ["/og.png"],
  },
};

/* Barva brskalnikovega okvirja na mobitelu = ozadje app (cink-950). */
export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sl" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
