/** 阶段 3：只提供已发布模板的发起入口，设计管理将在下一章加入。 */
'use client';
import Link from 'next/link';
import type { DashboardData } from '@bpm/core';
import { useRemote } from '@/lib/client';
import { Loading, ErrorState, ProcessIcon } from '@/components/ui';
export default function Page() {
  const { data, loading, error, reload } = useRemote<DashboardData>('/dashboard');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>选择流程，发起申请</h1>
          <p>此阶段先使用服务端内置的发布模板。</p>
        </div>
      </div>
      <div className="process-grid">
        {data.workflows
          .filter((w) => w.enabled)
          .map((w) => {
            const def = w.versions.at(-1)!.definition;
            return (
              <article className="process-card" key={w.id}>
                <ProcessIcon category={def.category} />
                <h2>{def.name}</h2>
                <p>{def.description}</p>
                <div className="process-card-bottom">
                  <Link className="button primary" href={`/start/${w.id}`}>
                    发起申请
                  </Link>
                </div>
              </article>
            );
          })}
      </div>
    </>
  );
}
