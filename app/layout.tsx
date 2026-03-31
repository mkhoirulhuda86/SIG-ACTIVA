 import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthGuard from "./components/AuthGuard";
import AosProvider from "./components/AosProvider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Dashboard - SIG ACTIVA",
  description: "Sistem Informasi Akuntansi PT Semen Indonesia Grup",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AosProvider>
          <AuthGuard>
            {children}
          </AuthGuard>
        </AosProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
