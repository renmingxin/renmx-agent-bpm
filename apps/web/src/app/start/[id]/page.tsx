/** 动态发起页路由，[id] 是流程 ID，由 StartProcess 读取参数并加载发布版本。 */
import { StartProcess } from '@/components/runtime';
export default function Page() {
  return <StartProcess />;
}
