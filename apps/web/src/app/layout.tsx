/** 最小根布局：先理解路由入口，复杂外壳在运行态章节加入。 */
import './globals.css';
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
