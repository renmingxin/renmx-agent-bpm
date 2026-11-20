/**
 * /assistant 路由的薄入口，负责把制度中心挂到全局布局。
 * 本文件不保存模型配置、文件或问答状态；需要浏览器交互的逻辑在客户端 KnowledgePage 中。
 */
import { KnowledgePage } from '@/components/assistant/knowledge-page';
export default function Page() {
  return <KnowledgePage />;
}
