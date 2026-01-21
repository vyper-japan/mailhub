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
      <body className="bg-white text-[#202124] antialiased selection:bg-blue-200 font-sans">
        {children}
      </body>
    </html>
  );
}
