/**
 * 运行态工作台：从实例与任务推导当前用户的待办、已办和发起记录。
 * Task 表示某个人要处理的一步；Instance 表示整份申请，二者不能混淆。
 * 页签、搜索与状态筛选只派生显示结果，不修改服务端原始数据。
 */
'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  Clock3,
  FilePlus2,
  GitBranch,
  ListFilter,
  Plus,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { userName, type DashboardData } from '@bpm/core';
import { formatDate, useApp, useRemote } from '@/lib/client';
import { Empty, ErrorState, Loading, ProcessIcon, StatusBadge } from './ui';

const tabs = [
  { id: 'pending', label: '待我审批' },
  { id: 'started', label: '我发起的' },
  { id: 'handled', label: '我已处理' },
  { id: 'all', label: '全部申请' },
] as const;
export function Workbench() {
  const { user } = useApp();
  const { data, error, loading, reload } = useRemote<DashboardData>('/dashboard');
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('pending');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  const pending = data.tasks.filter((t) => t.assignee === user.id && t.status === 'pending');
  const handled = data.tasks.filter((t) => t.assignee === user.id && t.status !== 'pending');
  const started = data.instances.filter((i) => i.applicant === user.id);
  const active = data.workflows.filter((w) => w.enabled && w.versions.length);
  const completed = data.instances.filter((i) => i.status === 'completed').length;
  const rows = data.instances
    .filter(
      (i) =>
        (tab === 'pending'
          ? pending.some((t) => t.instanceId === i.id)
          : tab === 'started'
            ? i.applicant === user.id
            : tab === 'handled'
              ? handled.some((t) => t.instanceId === i.id)
              : true) &&
        (status === 'all' || i.status === status) &&
        `${i.title}${i.serial}${i.definition.name}${userName(i.applicant)}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const counters = {
    pending: pending.length,
    started: started.length,
    handled: new Set(handled.map((t) => t.instanceId)).size,
    all: data.instances.length,
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORK, IN FLOW</div>
          <h1>
            工作台<span className="heading-dot">.</span>
          </h1>
          <p>每一步清晰可见，让协作自然发生。</p>
        </div>
        <Link className="button primary" href="/processes?start=1">
          <Plus size={17} />
          发起申请
        </Link>
      </div>
      <section className="welcome-banner">
        <div>
          <span className="welcome-kicker">
            <span className="live-dot" />
            一切，正在有序进行
          </span>
          <h2>
            你好，{user.name} <span className="wave">☀</span>
          </h2>
          <p>
            你有 <strong>{pending.length} 项待办</strong> 等待处理，开启高效的一天吧。
          </p>
          <span className="banner-date">
            <CalendarDays size={14} />
            {new Intl.DateTimeFormat('zh-CN', {
              timeZone: 'Asia/Shanghai',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            }).format(new Date())}
          </span>
        </div>
        <div className="flow-art" aria-hidden="true">
          <div className="art-grid" />
          <div className="art-line horizontal" />
          <div className="art-line vertical" />
          <span className="art-node node-one">
            <FilePlus2 size={23} />
            <small>申请发起</small>
          </span>
          <span className="art-node node-two">
            <Check size={24} />
            <small>协作审批</small>
          </span>
          <span className="art-node node-three">
            <GitBranch size={23} />
            <small>有序流转</small>
          </span>
          <span className="art-spark">
            <Sparkles size={17} />
          </span>
          <span className="art-dot" />
        </div>
      </section>
      <section className="stats-grid" aria-label="工作统计">
        {[
          {
            label: '待我审批',
            count: pending.length,
            text: '等待你的下一步',
            icon: Clock3,
            color: 'blue',
            click: 'pending',
          },
          {
            label: '我发起的',
            count: started.length,
            text: '所有申请，随时跟进',
            icon: Send,
            color: 'violet',
            click: 'started',
          },
          {
            label: '我已处理',
            count: counters.handled,
            text: '每一次决策都有记录',
            icon: CheckCheck,
            color: 'green',
            click: 'handled',
          },
          {
            label: '可用流程',
            count: active.length,
            text: '覆盖日常业务场景',
            icon: GitBranch,
            color: 'orange',
            click: null,
          },
        ].map((s) => (
          <button
            key={s.label}
            className="stat-card"
            onClick={() => {
              if (s.click) setTab(s.click as typeof tab);
              else window.location.assign('/processes?start=1');
            }}
          >
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={`stat-icon ${s.color}`}>
                <s.icon size={18} />
              </span>
            </div>
            <div className="stat-value">
              {String(s.count).padStart(2, '0')}
              <span>项</span>
            </div>
            <div className="stat-bottom">
              {s.text}
              <ArrowUpRight size={14} />
            </div>
          </button>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="panel task-panel">
          <div className="panel-heading">
            <div>
              <h2>我的工作事项</h2>
              <p>聚焦当下，让每一项工作及时向前。</p>
            </div>
            <button className="text-button" onClick={reload}>
              刷新
              <ArrowDownLeft size={14} />
            </button>
          </div>
          <div className="task-tabs" role="tablist" aria-label="申请分类">
            {tabs.map((t) => (
              <button
                role="tab"
                aria-selected={tab === t.id}
                key={t.id}
                className={tab === t.id ? 'selected' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                <span>{counters[t.id]}</span>
              </button>
            ))}
          </div>
          <div className="table-toolbar">
            <search className="search-box">
              <Search size={16} />
              <label className="sr-only" htmlFor="task-search">
                搜索申请
              </label>
              <input
                id="task-search"
                type="search"
                placeholder="搜索申请标题、流程或编号"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </search>
            <label className="filter-select">
              <ListFilter size={15} />
              <span className="sr-only">筛选状态</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">全部状态</option>
                <option value="running">流转中</option>
                <option value="completed">已完成</option>
                <option value="rejected">已驳回</option>
              </select>
            </label>
          </div>
          <div className="table-scroll">
            <table className="tasks-table">
              <thead>
                <tr>
                  <th>申请事项</th>
                  <th>发起人</th>
                  <th>当前节点 / 状态</th>
                  <th>发起时间</th>
                  <th className="align-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const task = pending.find((t) => t.instanceId === i.id);
                  return (
                    <tr key={i.id}>
                      <td>
                        <Link className="task-title" href={`/instances/${i.id}`}>
                          <ProcessIcon category={i.definition.category} small />
                          <span>
                            <strong>{i.title}</strong>
                            <small>
                              {i.definition.name}
                              <span className="dot-separator">·</span>
                              {i.serial}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="person">
                          <span className="mini-avatar">{userName(i.applicant).slice(0, 1)}</span>
                          {userName(i.applicant)}
                        </span>
                      </td>
                      <td>
                        <div className="table-status">
                          <span>
                            {i.status === 'running'
                              ? i.definition.nodes.find((n) => n.id === i.currentNodeId)?.data.label
                              : '流程已结束'}
                          </span>
                          <StatusBadge status={i.status} />
                        </div>
                      </td>
                      <td className="muted nowrap">{formatDate(i.createdAt, true)}</td>
                      <td className="align-right">
                        <Link
                          className={task ? 'row-action' : 'row-action subtle'}
                          href={`/instances/${i.id}`}
                        >
                          {task ? '去处理' : '查看'}
                          <ChevronRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <Empty
              title={tab === 'pending' && !search ? '待办已清空，做得不错' : '没有找到相关申请'}
              description={
                tab === 'pending'
                  ? '新的审批到达后，会出现在这里。'
                  : '尝试调整搜索内容或申请分类。'
              }
            />
          )}
          <div className="table-footer">
            <span>共 {rows.length} 条工作事项</span>
            <span>
              协作的每一步，都值得认真对待 <span className="tiny-spark">✦</span>
            </span>
          </div>
        </section>
        <aside className="dashboard-aside">
          <section className="panel quick-start">
            <div className="section-label">
              <h2>快速发起</h2>
              <span>QUICK START</span>
            </div>
            <p>把日常事务，交给流程。</p>
            <div>
              {active.slice(0, 4).map((w) => {
                const def = w.versions.at(-1)!.definition;
                return (
                  <Link key={w.id} href={`/start/${w.id}`} className="quick-item">
                    <ProcessIcon category={def.category} />
                    <div>
                      <strong>{def.name}</strong>
                      <small>
                        {def.fields.length} 个表单字段 · v{w.versions.length}
                      </small>
                    </div>
                    <ArrowUpRight size={17} />
                  </Link>
                );
              })}
            </div>
            {!active.length && <p>暂无已发布流程</p>}
            <Link className="quick-all" href="/processes?start=1">
              查看全部流程
              <ArrowRight size={15} />
            </Link>
          </section>
          <section className="panel overview-panel">
            <div className="section-label">
              <h2>流程运行概览</h2>
              <span className="live-dot" />
            </div>
            <p>工作空间的协作动态</p>
            <div className="overview-number">
              <strong>{data.instances.length}</strong>
              <span>累计发起申请</span>
              <span className="overview-icon">
                <GitBranch size={24} />
              </span>
            </div>
            {[
              {
                text: '流转中',
                count: data.instances.filter((i) => i.status === 'running').length,
                class: 'blue',
              },
              { text: '已完成', count: completed, class: 'green' },
              {
                text: '已驳回',
                count: data.instances.filter((i) => i.status === 'rejected').length,
                class: 'orange',
              },
            ].map((r) => (
              <div className="overview-row" key={r.text}>
                <div>
                  <span>{r.text}</span>
                  <strong>
                    {r.count}
                    <small>项</small>
                  </strong>
                </div>
                <div className="progress-track">
                  <span
                    className={r.class}
                    style={{
                      width: `${data.instances.length ? (r.count / data.instances.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="overview-foot">
              <CircleCheck size={14} /> 流转记录持久保存
            </div>
          </section>
          <div className="aside-quote">
            <span>“</span>好的流程，让团队
            <br />
            把时间留给更重要的事。<small>LESS FRICTION. MORE FLOW.</small>
          </div>
        </aside>
      </div>
    </>
  );
}
