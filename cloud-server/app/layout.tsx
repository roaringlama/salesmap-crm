import type { Metadata } from "next";
import "../src/styles.css";

export const metadata: Metadata = {
  title: "SalesMap CRM · 销售协作平台",
  description: "客户、项目、售后与公司关系拓扑管理",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
