import type { Metadata } from "next";

import { WorkbenchShell } from "@/components/workbench-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI 跨境上架工作台",
  description: "面向跨境电商的采集、商品任务、AI 处理、图片生成与 Excel 导出工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <WorkbenchShell>{children}</WorkbenchShell>
      </body>
    </html>
  );
}
