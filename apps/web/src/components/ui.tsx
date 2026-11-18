/**
 * 跨页面的轻量展示组件。
 * 图标、状态标签、加载/空/错误状态集中管理，确保不同业务页面表达一致。
 */
'use client';

import {
  ArrowRight,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Clock3,
  Coffee,
  FileText,
  LoaderCircle,
  ShoppingBag,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { Definition, InstanceStatus } from '@bpm/core';

export function ProcessIcon({
  category,
  small = false,
}: {
  category: Definition['category'];
  small?: boolean;
}) {
  const Icon = { expense: Wallet, leave: Coffee, purchase: ShoppingBag, custom: FileText }[
    category
  ];
  return (
    <span className={`process-icon ${category} ${small ? 'small' : ''}`}>
      <Icon size={small ? 18 : 23} strokeWidth={1.8} />
    </span>
  );
}
export function StatusBadge({ status }: { status: InstanceStatus }) {
  const config = {
    running: ['流转中', Clock3],
    completed: ['已完成', CircleCheck],
    rejected: ['已驳回', XCircle],
  } as const;
  const [text, Icon] = config[status];
  return (
    <span className={`badge ${status}`}>
      <Icon size={12} />
      {text}
    </span>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={24} />
      <p>正在载入工作空间…</p>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert size={28} />
      <h3>暂时无法载入</h3>
      <p>{error}</p>
      <button className="button" onClick={retry}>
        重新加载
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
export function Empty({
  title = '这里暂时没有申请',
  description = '新的协作，从发起一份申请开始。',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <CheckCheck size={30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
