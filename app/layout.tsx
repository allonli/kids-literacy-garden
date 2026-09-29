import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./character-tools.css";
import "./daily-study.css";
import "./weekend-review.css";
import "./accounts.css";

export const metadata: Metadata = {
  title: "识字小花园",
  description: "先学组词，再认单字，陪孩子稳稳记住每一个字。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f3e8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
