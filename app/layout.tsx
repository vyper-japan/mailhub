import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MailHub",
  description: "Shared inbox viewer (Hello Inbox)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-[#0f172a] text-[#cbd5e1] antialiased selection:bg-blue-500/30 font-sans">
        {children}
      </body>
    </html>
  );
}
