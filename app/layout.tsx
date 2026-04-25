import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "On-Call Manager",
  description: "Quản lý lịch trực và thông báo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
