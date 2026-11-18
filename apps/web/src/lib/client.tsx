/**
 * 浏览器请求与状态工具：当前用户 Context、统一 JSON API、可取消的数据读取和北京时间显示。
 * 组件通过 useRemote 读取数据，通过 request + json 提交变更，避免散落重复 fetch。
 */
'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { users, type User } from '@bpm/core';

export const AppContext = createContext<{
  user: User;
  setUser: (id: string) => void;
  notify: (message: string) => void;
  request: <T>(url: string, options?: RequestInit) => Promise<T>;
}>({
  user: users[0],
  setUser: () => {},
  notify: () => {},
  request: async () => {
    throw new Error('Provider missing');
  },
});
export const useApp = () => useContext(AppContext);

export function useRemote<T>(path: string) {
  const { request } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey((n) => n + 1), []);
  useEffect(() => {
    // 切换身份或路由时取消旧请求，阻止慢响应覆盖新页面。
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    request<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request, path, key]);
  return { data, setData, error, loading, reload };
}
export const json = (method: string, value: unknown): RequestInit => ({
  method,
  body: JSON.stringify(value),
});
export const formatDate = (value: string, time = false) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(new Date(value));
