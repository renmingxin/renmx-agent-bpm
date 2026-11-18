/**
 * 首次启动演示数据：只初始化空库，不覆盖已有流程。
 * 所有示例申请都调用正式 start/act 入口，确保待办和历史来自真实引擎。
 * BPM_SEED=false 可以关闭。本地身份与业务数据均为虚构示例。
 */
import { createTemplate, type FormData } from '@bpm/core';
import type { BpmService } from './bpm.service';
import type { Store } from './store';

export async function seedDemo(service: BpmService, store: Store) {
  const seeded = await store.transaction(async (tx) => {
    await tx.seedLock();
    if ((await tx.all('workflows')).length) return false;
    for (const kind of ['expense', 'leave', 'purchase'] as const) {
      const at = new Date().toISOString();
      const definition = createTemplate(kind);
      await tx.put('workflows', {
        id: `wf-${kind}`,
        draft: definition,
        versions: [{ version: 1, definition: structuredClone(definition), publishedAt: at }],
        enabled: true,
        revision: 1,
        createdAt: at,
        updatedAt: at,
      });
    }
    return true;
  });
  if (!seeded) return;
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const examples: { wf: string; title: string; data: FormData }[] = [
    {
      wf: 'expense',
      title: '杭州客户拜访 · 差旅费用报销',
      data: {
        category: '差旅交通',
        amount: 2680,
        date,
        reason: '杭州客户拜访的高铁、住宿及市内交通费用。',
      },
    },
    {
      wf: 'purchase',
      title: '设计团队显示器采购申请',
      data: {
        category: '办公设备',
        amount: 6800,
        date,
        reason: '为新入职设计师采购两台 27 英寸专业显示器。',
      },
    },
    {
      wf: 'leave',
      title: '年假申请 · 休息一下，再出发',
      data: {
        category: '年假',
        startDate: date,
        days: 2,
        reason: '申请两天年假，相关工作已完成交接。',
      },
    },
    {
      wf: 'expense',
      title: '产品工作坊 · 办公物料报销',
      data: {
        category: '办公费用',
        amount: 486,
        date,
        reason: '产品共创工作坊的纸笔、白板贴和打印费用。',
      },
    },
    {
      wf: 'expense',
      title: '上海行业交流会 · 差旅报销',
      data: {
        category: '差旅交通',
        amount: 4280,
        date,
        reason: '参加行业交流会的差旅与住宿费用。',
      },
    },
    {
      wf: 'leave',
      title: '调休申请 · 周五下午',
      data: { category: '调休', startDate: date, days: 0.5, reason: '使用项目上线加班调休。' },
    },
  ];
  for (const [index, sample] of examples.entries()) {
    const instance = await service.start(
      `wf-${sample.wf}`,
      index === 5 ? 'u-chen' : 'u-lin',
      sample.title,
      sample.data,
    );
    if (index >= 4) {
      const task = (await store.all('tasks')).find(
        (t) => t.instanceId === instance.id && t.status === 'pending',
      )!;
      await service.act(task.id, 'u-chen', 'approve', '情况属实，同意申请');
    }
    // 错开示例发起时间便于观察排序；审批记录保持真实时间。
    const stored = (await store.get('instances', instance.id))!;
    stored.createdAt = new Date(Date.now() - (index + 1) * 42 * 60_000).toISOString();
    await store.put('instances', stored);
  }
}
