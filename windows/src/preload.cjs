'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nova', {
  state: () => ipcRenderer.invoke('nova:state'),
  refresh: () => ipcRenderer.invoke('nova:refresh'),
  signIn: () => ipcRenderer.invoke('nova:signin'),
  signOut: () => ipcRenderer.invoke('nova:signout'),
  add: input => ipcRenderer.invoke('nova:add', input),
  preferences: input => ipcRenderer.invoke('nova:preferences', input),
  testNotification: () => ipcRenderer.invoke('nova:notification-test'),
  copy: number => ipcRenderer.invoke('nova:copy', number),
  hide: () => ipcRenderer.invoke('nova:hide'),
  minimize: () => ipcRenderer.invoke('nova:minimize'),
  quit: () => ipcRenderer.invoke('nova:quit'),
  ready: () => ipcRenderer.send('nova:renderer-ready'),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('nova:state', listener);
    return () => ipcRenderer.removeListener('nova:state', listener);
  }
});
