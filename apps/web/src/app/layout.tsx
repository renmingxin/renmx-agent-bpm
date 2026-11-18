/**
 * App Router 根布局：设置页面元信息与中文语言，装配全局 Provider 和应用外壳。
 * 布局保持 Server Component；需要交互的部分通过客户端组件边界接入。
 */
import type { Metadata } from 'next';
import { AppProvider, Shell } from '@/components/shell';
import './globals.css';

export const metadata: Metadata = {
  title: '流序 Flowline · 工作流，让协作有序',
  description: '可视化流程设计、动态表单与审批工作台',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
