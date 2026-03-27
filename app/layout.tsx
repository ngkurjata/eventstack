import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Roboto_Mono } from "next/font/google";
import BrandLogo from "@/app/components/BrandLogo";
import "./globals.css";

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
    icon: "/logo-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <header
          style={{
            borderBottom: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          <div
            style={{
              maxWidth: 1200,
              margin: "0 auto",
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <Link
  href="/"
  aria-label="Go to homepage"
  style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
>
  <BrandLogo />
</Link>
          </div>
        </header>

        <main>{children}</main>
      </body>
    </html>
  );
}