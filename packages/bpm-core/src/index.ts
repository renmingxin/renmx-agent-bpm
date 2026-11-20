/** 共享包的唯一公共入口；前后端通过它依赖模型与引擎，不互相依赖。 */
export * from './types';
export * from './validation';
export * from './engine';
export * from './templates';
// 助手的协议与纯规则同样由共享包导出，避免前端依赖 NestJS、模型 SDK 或数据库代码。
export * from './assistant';
export * from './assistant-checks';
