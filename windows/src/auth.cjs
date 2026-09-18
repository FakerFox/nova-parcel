'use strict';
const { BrowserWindow, session } = require('electron');
const { readFileSync } = require('node:fs');
const { officialURL, cabinetURL } = require('./security.cjs');
const { validNumber } = require('./core.cjs');
const LOGIN = 'https://new.novaposhta.ua/auth/login-private-person';
class AuthSession {
  constructor({ bridgePath, onReady, onError, onHide }) {
    this.bridge = readFileSync(bridgePath, 'utf8'); this.onReady = onReady; this.onError = onError; this.onHide = onHide;
    this.partition = session.fromPartition('persist:novaposhta');
    this.partition.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    this.partition.setPermissionCheckHandler(() => false);
    this.partition.on('will-download', event => event.preventDefault());
  }
  prepare(restoring = false) {
    if (this.window && !this.window.isDestroyed()) return;
    const win = new BrowserWindow({ width: 960, height: 760, minWidth: 720, minHeight: 560, show: false,
      title: 'Вхід до Нової пошти · Nova Parcel', autoHideMenuBar: true,
      webPreferences: { session: this.partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    this.window = win;
    win.removeMenu();
    win.on('close', event => { event.preventDefault(); win.hide(); this.onHide(); });
    const contents = win.webContents;
    contents.on('will-navigate', (event, url) => { if (!officialURL(url)) event.preventDefault(); });
    contents.on('will-redirect', (event, url, _sameDocument, mainFrame) => { if (mainFrame && !officialURL(url)) event.preventDefault(); });
    contents.setWindowOpenHandler(({ url }) => {
      if (officialURL(url)) contents.loadURL(url).catch(() => this.onError('Не вдалося відкрити сайт Нової пошти.'));
      return { action: 'deny' };
    });
    contents.on('did-finish-load', () => this.onReady());
    contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) this.onReady(); });
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.onError('Не вдалося завантажити кабінет. Перевірте інтернет і повторіть вхід.');
    });
    contents.on('render-process-gone', () => this.onError('Кабінет закрився. Відкрийте акаунт повторно.'));
    contents.loadURL(restoring ? 'https://new.novaposhta.ua/dashboard' : LOGIN).catch(() => {});
  }
  show(restoring) { this.prepare(restoring); this.window.show(); this.window.focus(); }
  hide() { this.window?.hide(); }
  reload() { if (this.window && !this.window.isDestroyed()) this.window.webContents.reload(); }
  async sync(numbers, accountID) {
    this.prepare(!!accountID);
    const contents = this.window.webContents;
    if (contents.isLoadingMainFrame()) return { kind: 'loading' };
    if (!cabinetURL(contents.getURL())) return { kind: 'login' };
    const safeNumbers = numbers.filter(item => validNumber(item?.number)).map(item => ({number:item.number, direction:item.direction === 'outgoing' ? 'outgoing' : 'incoming'}));
    // This executes only in the official origin. No preload/native bridge is
    // present in this window, and the returned object contains no credentials.
    return contents.executeJavaScript(`(async () => { ${this.bridge}\nreturn await window.novaParcelSync(${JSON.stringify(safeNumbers)}, ${JSON.stringify(accountID)}); })()`);
  }
  async clear() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    await this.partition.clearStorageData(); await this.partition.clearCache();
  }
  destroy() { if (this.window && !this.window.isDestroyed()) this.window.destroy(); }
}
module.exports = { AuthSession };
