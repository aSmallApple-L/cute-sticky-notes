'use strict';

/**
 * 预加载脚本：通过 contextBridge 向渲染进程暴露受限 API
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sticky', {
  // 加载指定便签（不存在则主进程创建）
  loadNote: (id) => ipcRenderer.invoke('note:load', id),
  // 保存便签内容（防抖由渲染层控制）
  saveNote: (note) => ipcRenderer.send('note:save', note),
  // 最小化到托盘
  minimize: () => ipcRenderer.send('note:minimize'),
  // 关闭（后台运行）
  close: () => ipcRenderer.send('note:close'),
  // 新建便签
  newNote: () => ipcRenderer.send('note:new'),
  // 点击穿透开关
  setPassthrough: (on) => ipcRenderer.send('note:set-passthrough', on),
  // 置顶开关
  toggleTopmost: () => ipcRenderer.invoke('note:toggle-topmost'),
  // 缩放窗口
  resize: (width, height) => ipcRenderer.send('note:resize', width, height),
  // 主题（调色盘）
  getTheme: () => ipcRenderer.invoke('theme:load'),
  saveTheme: (theme) => ipcRenderer.send('theme:save', theme),
  // 主进程 -> 渲染进程 事件
  onReminder: (cb) => ipcRenderer.on('reminder:fire', (_e, payload) => cb(payload)),
  onBounds: (cb) => ipcRenderer.on('note:bounds', (_e, bounds) => cb(bounds)),
  onPassthrough: (cb) => ipcRenderer.on('passthrough:state', (_e, on) => cb(on)),
  onTopmost: (cb) => ipcRenderer.on('topmost:state', (_e, on) => cb(on)),
  onThemeChanged: (cb) => ipcRenderer.on('theme:changed', (_e, theme) => cb(theme)),
});
