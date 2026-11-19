/**
 * 全局外壳与应用状态：侧栏导航、身份选择、指南弹窗和操作反馈。
 * AppProvider 保存演示身份；Shell 仅负责布局，不拥有流程业务数据。
 * request 随身份变化重新生成，依赖它的 useRemote 会重新加载该身份的页面状态。
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  GitBranch,
  LayoutDashboard,
  Layers3,
  Workflow,
  X,
} from 'lucide-react';
import { users, type User } from '@bpm/core';
import { AppContext, useApp } from '@/lib/client';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setCurrentUser] = useState<User>(users[0]);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem('bpm-user');
    setCurrentUser(users.find((u) => u.id === saved) ?? users[0]);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const setUser = useCallback((id: string) => {
    const next = users.find((u) => u.id === id);
    if (next) {
      setCurrentUser(next);
      localStorage.setItem('bpm-user', id);
    }
  }, []);
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(''), 5000);
  }, []);
  const request = useCallback(
    async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        ...options,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id, ...options?.headers },
      });
      const data = await response
        .json()
        .catch(() => ({ message: '服务暂时不可用，请确认 API 已启动' }));
      if (!response.ok)
        throw new Error(
          Array.isArray(data.message) ? data.message.join('；') : data.message || '请求失败',
        );
      return data;
    },
    [user.id],
  );
  return (
    <AppContext value={{ user, setUser, notify, request }}>
      {children}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </AppContext>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, setUser } = useApp();
  const help = useRef<HTMLDialogElement>(null);
  const designer = path.startsWith('/designer');
  const assistant = path.startsWith('/assistant');
  const isProcesses = path.startsWith('/processes') || designer;
  return (
    <div className={`app-shell ${designer ? 'designer-shell' : ''}`}>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Flowline 返回工作台">
          <span className="brand-mark">
            <Workflow size={25} strokeWidth={2.3} />
          </span>
          <span>
            流序 <b>Flowline</b>
          </span>
        </Link>
        <div className="workspace-switch">
          <span className="workspace-avatar">F</span>
          <div>
            <strong>我的工作空间</strong>
            <small>团队协作 · 简易 BPM</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">工作空间</div>
        <nav aria-label="主导航">
          <Link
            href="/"
            aria-label="工作台"
            title="工作台"
            className={!isProcesses && !assistant ? 'nav-item active' : 'nav-item'}
          >
            <LayoutDashboard size={19} />
            <span>工作台</span>
            {!isProcesses && !assistant && <span className="nav-dot" />}
          </Link>
          <Link
            href="/processes"
            aria-label="流程管理"
            title="流程管理"
            className={isProcesses ? 'nav-item active' : 'nav-item'}
          >
            <GitBranch size={19} />
            <span>流程管理</span>
          </Link>
          <Link
            href="/assistant"
            aria-label="智能助手"
            title="智能助手"
            className={assistant ? 'nav-item active' : 'nav-item'}
          >
            <BookOpen size={19} />
            <span>智能助手</span>
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <div className="note-icon">
              <Layers3 size={20} />
            </div>
            <strong>从想法，到有序协作</strong>
            <p>画出流程，连接每一步。</p>
            <Link href="/processes">
              设计你的流程
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <button className="help-link" onClick={() => help.current?.showModal()}>
            <BookOpen size={17} />
            <span>使用指南</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-footer">
            <span className="live-dot" />
            本地工作空间<span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>
              {assistant
                ? '智能助手与制度库'
                : designer
                  ? '流程设计器'
                  : isProcesses
                    ? '流程管理'
                    : path.startsWith('/start')
                      ? '发起申请'
                      : path.startsWith('/instances')
                        ? '申请详情'
                        : '工作台'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="environment-tag">
              <span className="live-dot" />
              演示环境
            </span>
            <button
              className="icon-button"
              aria-label="打开使用指南"
              onClick={() => help.current?.showModal()}
            >
              <CircleHelp size={19} />
            </button>
            <div className="topbar-divider" />
            <span className="avatar">{user.initials}</span>
            <div className="user-switch">
              <label htmlFor="current-user" className="sr-only">
                切换演示用户
              </label>
              <select id="current-user" value={user.id} onChange={(e) => setUser(e.target.value)}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.role}
                  </option>
                ))}
              </select>
              <small>切换身份，体验审批流转</small>
            </div>
          </div>
        </header>
        <main id="main-content" className={designer ? 'designer-main' : 'content'}>
          {children}
        </main>
        {!designer && (
          <footer className="page-footer">
            <span>FLOWLINE / 让每一次协作，都有迹可循。</span>
            <span>
              <span className="live-dot" /> 工作流引擎已就绪
            </span>
          </footer>
        )}
      </div>
      <dialog ref={help} className="modal help-modal">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">GETTING STARTED</span>
            <h2>让第一个流程跑起来</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭使用指南"
            onClick={() => help.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <ol className="guide-steps">
          <li>
            <strong>设计与发布</strong>
            <p>在流程管理中创建流程，配置表单、审批人和条件分支，保存并发布。</p>
          </li>
          <li>
            <strong>填写并发起</strong>
            <p>在工作台选择已发布流程，填写申请表单后提交。</p>
          </li>
          <li>
            <strong>审批与流转</strong>
            <p>右上角切换为节点审批人，在待办中核对表单、填写意见，再同意或驳回。</p>
          </li>
        </ol>
        <div className="info-note">
          当前使用可切换的演示身份；适合本地学习与验证，正式使用需要接入登录和权限系统。简易引擎支持串行审批与数字条件分支。
        </div>
        <button className="button primary full" onClick={() => help.current?.close()}>
          开始体验
          <ChevronRight size={16} />
        </button>
      </dialog>
    </div>
  );
}
