'use strict';
const { app, BrowserWindow, ipcMain, Menu, Tray, Notification, powerMonitor, screen, clipboard, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Tracker, fromRow, ready, validNumber } = require('./core.cjs');
const { trustedSender } = require('./security.cjs');
const { AuthSession } = require('./auth.cjs');

const smoke = process.argv.includes('--smoke-test');
const demo = smoke || process.argv.includes('--demo');
const appID = 'ua.local.novaparcel.windows';
app.setName('Nova Parcel');
if (demo) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'nova-parcel-demo-')));
app.setAppUserModelId(appID);
app.enableSandbox();
const htmlPath = path.join(__dirname, 'ui', 'index.html');
const htmlURL = pathToFileURL(htmlPath).href;
const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
let win, tray, tracker, auth, loginTimer, refreshTimer, saveTimer, closing = false;
let preferences = { pinned: false, notifications: false, bounds: null };
const activeNotifications = new Set();

function readJSON(name) {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), name), 'utf8')); } catch { return {}; }
}
function writeJSON(name, value) {
  if (demo) return;
  const file = path.join(app.getPath('userData'), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
function savePreferences() {
  try { writeJSON('preferences.json', preferences); }
  catch { tracker.error = 'Не вдалося зберегти налаштування.'; }
}
function state() {
  return { ...tracker.snapshot(), pinned: preferences.pinned, notifications: preferences.notifications,
    notificationSupported: Notification.isSupported(), loginAtLaunch: !demo && app.isPackaged && app.getLoginItemSettings({ path: process.execPath, args: ['--background'] }).openAtLogin,
    canAutoStart: !demo && app.isPackaged && process.platform === 'win32', demo,
    version: app.getVersion(), platform: 'Windows' };
}
function broadcast() { if (win && !win.isDestroyed()) win.webContents.send('nova:state', state()); }
function showWidget() { if (!win || win.isDestroyed()) return; win.show(); if (win.isMinimized()) win.restore(); win.focus(); }
function stopLoginPoll() { clearInterval(loginTimer); loginTimer = null; }
function signIn() {
  if (demo) return;
  tracker.awaitingLogin = true; tracker.error = null; tracker.refreshingSession = false; tracker.changed();
  auth.show(!!tracker.accountID); stopLoginPoll();
  loginTimer = setInterval(() => tracker.refresh(true), 5000);
}
function showNotification(title, body) {
  if (demo || !preferences.notifications || !Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: iconPath });
  activeNotifications.add(notification);
  notification.on('click', showWidget);
  notification.once('close', () => activeNotifications.delete(notification));
  notification.once('failed', () => {
    activeNotifications.delete(notification);
    tracker.error = 'Windows не прийняла сповіщення. Перевірте Налаштування → Система → Сповіщення.';
    tracker.changed();
  });
  notification.show();
}
function validBounds(bounds) {
  if (!bounds || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(bounds[k]))) return {};
  const width = Math.max(390, Math.min(600, bounds.width)), height = Math.max(560, Math.min(1200, bounds.height));
  const display = screen.getDisplayMatching({ x: bounds.x, y: bounds.y, width, height }).workArea;
  return { width: Math.min(width, display.width), height: Math.min(height, display.height),
    x: Math.max(display.x, Math.min(bounds.x, display.x + display.width - width)),
    y: Math.max(display.y, Math.min(bounds.y, display.y + display.height - height)) };
}
function createWindow() {
  win = new BrowserWindow({ width: 400, height: 690, minWidth: 390, minHeight: 560, maxWidth: 600,
    ...validBounds(preferences.bounds), frame: false, show: false, backgroundColor: '#f6f4f1',
    title: 'Nova Parcel', icon: iconPath, alwaysOnTop: preferences.pinned,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, spellcheck: false } });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.on('close', event => { if (!closing) { event.preventDefault(); win.hide(); } });
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (!win.isDestroyed() && !win.isMinimized()) { preferences.bounds = win.getBounds(); savePreferences(); } }, 400);
  };
  win.on('moved', remember); win.on('resized', remember);
  win.once('ready-to-show', () => { if (!smoke && !process.argv.includes('--background')) showWidget(); });
  win.loadFile(htmlPath);
}
function handle(name, callback) {
  ipcMain.handle(`nova:${name}`, async (event, input) => {
    if (!trustedSender(event, win?.webContents, htmlURL)) throw Error('Недозволений запит.');
    return callback(input);
  });
}
function registerIPC() {
  handle('state', () => state());
  handle('refresh', () => demo ? undefined : tracker.refresh(true));
  handle('signin', signIn);
  handle('signout', async () => {
    if (demo) return;
    stopLoginPoll(); for (const n of activeNotifications) n.close(); activeNotifications.clear();
    await tracker.signOut(); broadcast();
  });
  handle('add', async input => {
    if (demo) return { ok: false, error: 'Демо використовує лише вигадані посилки.' };
    if (typeof input?.number !== 'string' || input.number.length > 100 || typeof input?.title !== 'string' || input.title.length > 300) return { ok: false, error: 'Перевірте номер і назву посилки.' };
    try { return { ok: await tracker.add(input.number, input.title) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  handle('preferences', input => {
    if (typeof input?.pinned === 'boolean') { preferences.pinned = input.pinned; win.setAlwaysOnTop(input.pinned); }
    if (typeof input?.notifications === 'boolean') preferences.notifications = input.notifications;
    if (typeof input?.loginAtLaunch === 'boolean' && !demo && app.isPackaged && process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: input.loginAtLaunch, path: process.execPath, args: ['--background'] });
    }
    savePreferences(); broadcast(); return state();
  });
  handle('notification-test', () => {
    if (demo) return 'Тестове сповіщення недоступне в демо.';
    if (!Notification.isSupported()) return 'Сповіщення недоступні у цій системі.';
    preferences.notifications = true; savePreferences(); broadcast();
    showNotification('Nova Parcel', 'Повідомимо, коли статус посилки зміниться.');
    return 'Сповіщення передано Windows. Якщо банера немає, перевірте налаштування сповіщень і режим «Не турбувати».';
  });
  handle('copy', number => { if (validNumber(number) && tracker.parcels.some(p => p.id === number)) clipboard.writeText(number); });
  handle('hide', () => win.hide());
  handle('minimize', () => win.minimize());
  handle('quit', () => app.quit());
}
async function smokeTest() {
  const bridgePath = app.isPackaged ? path.join(process.resourcesPath, 'Bridge.js') : path.join(__dirname, '..', '..', 'Resources', 'Bridge.js');
  if (!fs.readFileSync(bridgePath, 'utf8').includes('window.novaParcelSync')) throw Error('Shared bridge is missing');
  const result = await win.webContents.executeJavaScript(`(async () => {
    const state = await window.nova.state();
    return { cards: document.querySelectorAll('.parcel-card').length,
      hasDescription: document.body.textContent.includes('Книжки на вихідні'), connected: state.connected,
      unsafeNode: typeof window.require !== 'undefined', api: Object.keys(window.nova).sort() };
  })()`);
  if (result.cards !== 2 || !result.hasDescription || !result.connected || result.unsafeNode) throw Error(`Renderer smoke check failed: ${JSON.stringify(result)}`);
  win.hide(); if (win.isVisible()) throw Error('Hide-to-tray check failed');
  win.show(); if (!win.isVisible()) throw Error('Restore-from-tray check failed');
  win.setAlwaysOnTop(true); if (!win.isAlwaysOnTop()) throw Error('Pin check failed');
  console.log('Nova Parcel Electron smoke test passed: cards, descriptions, preload isolation, hide/show, pin.');
}
if (!smoke && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWidget);
  app.on('activate', showWidget);
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    closing = true; clearInterval(refreshTimer); stopLoginPoll(); clearTimeout(saveTimer); auth?.destroy(); tray?.destroy();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const stored = readJSON('preferences.json');
    preferences = { pinned: stored.pinned === true, notifications: stored.notifications === true, bounds: stored.bounds };
    auth = demo ? { clear: async () => {}, destroy() {} } : new AuthSession({
      bridgePath: app.isPackaged ? path.join(process.resourcesPath, 'Bridge.js') : path.join(__dirname, '..', '..', 'Resources', 'Bridge.js'),
      onReady: () => setTimeout(() => tracker.refresh(true), 1500),
      onError: message => { tracker.error = message; tracker.changed(); }, onHide: stopLoginPoll
    });
    tracker = new Tracker({ saved: readJSON('parcels.json'), auth, persist: value => writeJSON('parcels.json', value),
      notify: parcel => showNotification(ready(parcel) ? 'Посилка вже чекає на вас 📦' : 'Статус посилки змінився', `${parcel.title}\n${parcel.id}\n${parcel.status}`) });
    if (demo) {
      tracker.accountID = 'demo'; tracker.lastRefresh = Date.now();
      tracker.parcels = [fromRow({ Number: '20450000000001', Description: 'Книжки на вихідні', Status: 'Прибув у відділення', StatusCode: '7', WarehouseRecipient: 'Київ · Відділення № 24' }),
        fromRow({ Number: '20450000000002', Description: 'Нова клавіатура', Status: 'Прямує до міста отримувача', StatusCode: '5', WarehouseRecipient: 'Київ · Поштомат № 1024', ExpectedDeliveryDate: '18.09.2026' })];
    }
    tracker.on('change', broadcast); tracker.on('signed-in', () => { stopLoginPoll(); auth.hide(); }); tracker.on('login-paused', stopLoginPoll);
    createWindow(); registerIPC();
    tray = new Tray(process.platform === 'win32' ? path.join(__dirname, '..', 'assets', 'icon.ico') : nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 }));
    tray.setToolTip('Nova Parcel — мої посилки');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Показати віджет', click: showWidget }, { label: 'Відкрити акаунт', enabled: !demo, click: signIn },
      { label: 'Оновити статуси', enabled: !demo, click: () => tracker.refresh(true) }, { type: 'separator' }, { label: 'Завершити Nova Parcel', click: () => app.quit() }
    ]));
    tray.on('click', showWidget); tray.on('double-click', showWidget);
    if (!demo) {
      if (tracker.accountID) auth.prepare(true);
      else tracker.refresh(true);
      refreshTimer = setInterval(() => tracker.refresh(), 30000);
      powerMonitor.on('resume', () => tracker.refresh(true));
    }
    if (smoke) {
      const timeout = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 30000);
      ipcMain.once('nova:renderer-ready', async event => {
        if (!trustedSender(event, win.webContents, htmlURL)) return;
        try { await smokeTest(); clearTimeout(timeout); app.quit(); }
        catch (error) { console.error(error); app.exit(1); }
      });
    }
  }).catch(error => { console.error('Nova Parcel failed to start:', error.message); app.exit(1); });
}
