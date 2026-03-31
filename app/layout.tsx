import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Roboto_Mono } from "next/font/google";
import BrandLogo from "@/app/components/BrandLogo";
import "./globals.css";
import "leaflet/dist/leaflet.css";

const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Roboto_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Event Stack",
  description: "Find trips around events",
  icons: {
    icon: "/logo.svg", // ✅ fixed (must exist in /public)
  },
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} app-shell antialiased`}
      >
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-[1200px] items-center px-4 py-3 sm:px-5">
            <Link
              href="/"
              aria-label="Go to homepage"
              className="inline-flex shrink-0 items-center"
            >
              <BrandLogo />
            </Link>
          </div>
        </header>

        <main className="min-h-[calc(100dvh-65px)] bg-white">
          {children}
        </main>
      </body>
    </html>
  );
}