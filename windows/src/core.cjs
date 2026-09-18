'use strict';
const { EventEmitter } = require('node:events');

const validNumber = value => typeof value === 'string' && /^[0-9]{14}$/.test(value);
const normalizedNumber = value => String(value ?? '').replace(/[\s-]/g, '');
const delivered = parcel => ['9', '10', '11'].includes(parcel.code);
const ready = parcel => ['7', '8'].includes(parcel.code);
const arrived = change => !ready(change.old) && ready(change.new);
const directionOf = parcel => parcel.direction === 'outgoing' ? 'outgoing' : 'incoming';
const fingerprint = parcel => `${parcel.code}|${parcel.status.trim()}`;
const text = (row, ...keys) => {
  for (const key of keys) {
    const value = row[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
  }
  return '';
};
function fromRow(row, now = Date.now()) {
  if (!row || typeof row !== 'object') return null;
  const id = text(row, 'Number', 'IntDocNumber', 'DocumentNumber');
  const status = text(row, 'Status', 'TrackingStatus', 'StatusDescription');
  const code = text(row, 'StatusCode', 'TrackingStatusCode');
  if (!validNumber(id) || !status || !code) return null;
  return { id, title: text(row, 'Description', 'CargoDescriptionString', 'CargoDescription', 'DescriptionOfCargo') || 'Посилка',
    status, code, origin: text(row, 'CitySender', 'CitySenderDescription'),
    destination: text(row, 'WarehouseRecipient', 'RecipientAddress', 'RecipientAddressDescription', 'CityRecipient'),
    expected: text(row, 'ScheduledDeliveryDate', 'ExpectedDeliveryDate'), updatedAt: now,
    direction: ['incoming', 'outgoing'].includes(row.direction) ? row.direction : '', isManual: false };
}
function merge(existing, incoming) {
  const map = new Map(existing.map(p => [p.id, p]));
  const changes = [];
  for (const item of incoming) {
    const parcel = { ...item }, old = map.get(parcel.id);
    if (!['incoming', 'outgoing'].includes(parcel.direction)) parcel.direction = directionOf(old || {});
    if (old) {
      parcel.isManual = old.isManual;
      if (parcel.title === 'Посилка') parcel.title = old.title;
      if (fingerprint(old) !== fingerprint(parcel)) changes.push({ old, new: parcel });
    }
    map.set(parcel.id, parcel);
  }
  return { parcels: [...map.values()].sort((a, b) => Number(delivered(a)) - Number(delivered(b)) || b.id.localeCompare(a.id)), changes };
}
function restore(saved) {
  const parcels = Array.isArray(saved?.parcels) ? saved.parcels.flatMap(p => {
    const parcel = fromRow({ Number: p?.id, Description: p?.title, Status: p?.status, StatusCode: p?.code,
      CitySender: p?.origin, RecipientAddress: p?.destination, ExpectedDeliveryDate: p?.expected, direction: p?.direction }, Number(p?.updatedAt) || 0);
    return parcel ? [{ ...parcel, direction: directionOf(parcel), isManual: p.isManual === true }] : [];
  }) : [];
  return { parcels, accountID: typeof saved?.accountID === 'string' && saved.accountID ? saved.accountID : null,
    lastRefresh: Number.isFinite(saved?.lastRefresh) ? saved.lastRefresh : null };
}
async function track(numbers, fetcher = fetch) {
  if (!numbers.every(validNumber)) throw Error('ТТН має містити 14 цифр.');
  const rows = [];
  for (let start = 0; start < numbers.length; start += 100) {
    const response = await fetcher('https://api.novaposhta.ua/v2.0/json/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ apiKey: '', modelName: 'TrackingDocument', calledMethod: 'getStatusDocuments',
        methodProperties: { Documents: numbers.slice(start, start + 100).map(DocumentNumber => ({ DocumentNumber })), Language: 'UA' } })
    });
    if (!response.ok) throw Error('Нова пошта тимчасово не відповідає.');
    const body = await response.json();
    if (body.success !== true || !Array.isArray(body.data)) throw Error('Перевірте ТТН або увійдіть до акаунта Нової пошти.');
    rows.push(...body.data);
  }
  return rows;
}
class Tracker extends EventEmitter {
  constructor({ saved, auth, publicTrack = track, persist = () => {}, notify = () => {}, now = Date.now } = {}) {
    super(); Object.assign(this, restore(saved));
    Object.assign(this, { auth, publicTrack, persist, notify, now, busy: false, error: null, awaitingLogin: false,
      generation: 0, retryCount: 0, lastAttempt: -Infinity, refreshingSession: false });
  }
  snapshot() { return { parcels: this.parcels, connected: !!this.accountID, lastRefresh: this.lastRefresh,
    busy: this.busy, error: this.error, awaitingLogin: this.awaitingLogin }; }
  changed() { this.emit('change', this.snapshot()); }
  save() {
    try { this.persist({ parcels: this.parcels, accountID: this.accountID, lastRefresh: this.lastRefresh }); }
    catch { this.error = 'Не вдалося зберегти посилки на цьому комп’ютері.'; }
  }
  apply(rows, accountID = this.accountID) {
    if (!Array.isArray(rows)) throw Error('Формат відповіді Нової пошти змінився.');
    const incoming = rows.map(row => fromRow(row, this.now())).filter(Boolean);
    if (rows.length && !incoming.length) throw Error('Формат статусів змінився. Збережені дані залишилися без змін.');
    const switched = accountID !== this.accountID;
    const result = merge(switched ? [] : this.parcels, incoming);
    this.parcels = result.parcels; this.accountID = accountID;
    this.lastRefresh = this.now(); this.error = null; this.retryCount = 0;
    this.save();
    for (const change of result.changes) this.notify(change.new);
    const arrival = result.changes.find(arrived);
    if (arrival) this.emit('arrival', arrival.new);
  }
  async refresh(force = false) {
    if (this.busy || (!force && this.now() - this.lastAttempt < Math.min(3600000, 300000 * 2 ** this.retryCount))) return;
    if (!this.accountID && !this.awaitingLogin && !this.parcels.length) return;
    const generation = this.generation;
    this.busy = true; this.lastAttempt = this.now(); this.changed();
    try {
      if (this.accountID || this.awaitingLogin) {
        const result = await this.auth.sync(this.parcels.map(p => ({number:p.id, direction:directionOf(p)})), this.accountID);
        if (generation !== this.generation) return;
        if (result?.kind === 'success') {
          if (typeof result.accountID !== 'string' || !result.accountID) throw Error('Неповна відповідь кабінету.');
          this.apply(result.rows, result.accountID);
          const wasAwaiting = this.awaitingLogin;
          this.awaitingLogin = false; this.refreshingSession = false;
          if (wasAwaiting) this.emit('signed-in');
        } else if (result?.kind === 'expired') {
          if (!this.refreshingSession) { this.refreshingSession = true; this.auth.reload(); }
          else { this.error = 'Сесію завершено. Відкрийте акаунт і увійдіть повторно.'; this.retryCount = 3; this.emit('login-paused'); }
        } else if (result?.kind === 'login') {
          if (this.accountID) this.error = 'Потрібен повторний вхід до Нової пошти.';
        } else if (result?.kind !== 'loading') throw Error(result?.message || 'Не вдалося синхронізувати посилки.');
      } else {
        const rows = await this.publicTrack(this.parcels.map(p => p.id));
        if (generation !== this.generation) return;
        if (!rows.length) throw Error('Нова пошта не повернула статусів. Спробуйте увійти до акаунта.');
        this.apply(rows);
      }
    } catch (error) {
      if (generation === this.generation) {
        this.error = error instanceof Error ? error.message : 'Не вдалося оновити статуси.';
        this.retryCount = Math.min(4, this.retryCount + 1); this.emit('login-paused');
      }
    } finally { this.busy = false; this.changed(); }
  }
  async add(raw, title = '', direction = 'incoming') {
    if (!['incoming', 'outgoing'].includes(direction)) throw Error('Оберіть напрямок посилки.');
    const number = normalizedNumber(raw);
    if (!validNumber(number)) throw Error('ТТН має містити 14 цифр.');
    if (this.parcels.some(p => p.id === number)) throw Error('Ця посилка вже відстежується.');
    if (this.busy) throw Error('Дочекайтеся завершення оновлення.');
    this.busy = true; this.changed(); const generation = this.generation;
    try {
      let rows;
      if (this.accountID) {
        const result = await this.auth.sync([...this.parcels.map(p => ({number:p.id, direction:directionOf(p)})), {number, direction}], this.accountID);
        if (result?.kind !== 'success' || result.accountID !== this.accountID) throw Error('Відкрийте акаунт і повторіть вхід.');
        rows = result.rows;
      } else rows = await this.publicTrack([number]);
      if (generation !== this.generation) return false;
      const parcel = Array.isArray(rows) ? rows.map(row => fromRow(row, this.now())).find(p => p?.id === number) : null;
      if (!parcel) throw Error('Посилку не знайдено. Перевірте ТТН або увійдіть до акаунта.');
      parcel.isManual = true;
      if (!parcel.direction) parcel.direction = direction;
      if (String(title).trim()) parcel.title = String(title).trim().slice(0, 300);
      this.parcels = merge(this.parcels, [parcel]).parcels;
      this.error = null; this.lastRefresh = this.now(); this.save(); return true;
    } finally { this.busy = false; this.changed(); }
  }
  async signOut() {
    ++this.generation; this.awaitingLogin = false; this.parcels = []; this.accountID = null;
    this.lastRefresh = null; this.error = null; this.refreshingSession = false; this.retryCount = 0;
    this.save(); this.changed(); await this.auth.clear();
  }
}
module.exports = { validNumber, normalizedNumber, delivered, ready, arrived, directionOf, fingerprint, fromRow, merge, restore, track, Tracker };
