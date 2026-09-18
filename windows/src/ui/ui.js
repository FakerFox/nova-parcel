'use strict';
const $ = id => document.getElementById(id);
const symbols = {
  box:'<path d="m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5"/>',
  pin:'<path d="m16 3 5 5-3 1-4 5v4l-3-3-6 6 M4 10h4l5-4 1-3 M4 10l10 10"/>',
  settings:'<path d="M3 6h5m4 0h9 M3 12h11m4 0h3 M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  refresh:'<path d="M20 7v5h-5 M4 17a8 8 0 0 0 14 1 M20 7A8 8 0 0 0 6 5L3 8 M3 3v5h5"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4"/><circle cx="19" cy="4" r="3"/>',
  arrow:'<path d="M6 18 18 6 M6 6h12v12"/>',
  plus:'<path d="M12 5v14 M5 12h14"/>',
  shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z M8 12l3 3 5-6"/>',
  truck:'<path d="M3 4h11v12H3z M14 8h4l3 4v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  location:'<path d="M18 9c0 5-6 12-6 12S6 14 6 9a6 6 0 1 1 12 0Z"/><circle cx="12" cy="9" r="2"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4 M17 3v4 M3 10h18 M8 14h2 M14 14h2"/>',
  tray:'<path d="m3 14 3-9h12l3 9v6H3v-6Z M3 14h5l2 3h4l2-3h5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${symbols[name] || symbols.box}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
let current, showCompleted = false, toastTimer, contentKey, selectedDirection = 'incoming', revealSequence = 0;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
async function run(action) { try { return await action(); } catch { toast('Не вдалося виконати дію. Спробуйте ще раз.'); } }
function card(parcel) {
  const delivered = ['9','10','11'].includes(parcel.code), ready = ['7','8'].includes(parcel.code);
  const phase = delivered ? 3 : ready ? 2 : ['1','2'].includes(parcel.code) ? 0 : 1;
  return `<article data-parcel-id="${escape(parcel.id)}" class="parcel-card ${ready ? 'ready' : delivered ? 'delivered' : ''}">
    <div class="card-stage">${icon(ready ? 'box' : delivered ? 'check' : 'truck')}<span>${ready ? (parcel.direction === 'outgoing' ? 'ЧЕКАЄ НА ОТРИМУВАЧА' : 'МОЖНА ЗАБИРАТИ') : delivered ? 'ОТРИМАНО' : ['1','2'].includes(parcel.code) ? 'ОЧІКУЄ ВІДПРАВКИ' : 'У ДОРОЗІ'}</span><span class="direction" title="${parcel.direction === 'outgoing' ? 'Відправлення' : 'Отримання'}">${parcel.direction === 'outgoing' ? '↗' : '↙'}</span></div>
    <h2 class="parcel-title" title="${escape(parcel.title)}">${escape(parcel.title)}</h2>
    <button class="ttn" data-copy="${escape(parcel.id)}" title="Скопіювати ТТН">${escape(parcel.id)}</button>
    <div class="progress" aria-label="Етап доставки ${phase + 1} із 4">${[0,1,2,3].map(i => `<span class="${i <= phase ? 'done' : ''}"></span>`).join('')}</div>
    <p class="status">${escape(parcel.status)}</p>
    ${parcel.destination ? `<div class="detail">${icon('location')}<span>${escape(parcel.destination)}</span></div>` : ''}
    ${parcel.expected && !delivered && !ready ? `<div class="detail expected">${icon('calendar')}<span>Очікуємо: ${escape(parcel.expected)}</span></div>` : ''}
    ${Date.now() - parcel.updatedAt > 900000 ? '<p class="stale">Статус може бути застарілим</p>' : ''}
  </article>`;
}
function render(state) {
  current = state;
  const reveal = state.revealRequest;
  const shouldReveal = reveal && reveal.sequence !== revealSequence;
  if (shouldReveal) {
    revealSequence = reveal.sequence; selectedDirection = reveal.direction;
    if (reveal.completed) showCompleted = true;
  }
  $('demo-banner').hidden = !state.demo;
  $('pin').classList.toggle('active', state.pinned); $('pin').setAttribute('aria-pressed', String(state.pinned));
  $('connection-dot').className = `dot ${state.error ? 'error-dot' : state.connected || state.parcels.length ? 'connected' : ''}`;
  $('last-refresh').textContent = state.busy ? 'Перевіряємо статуси…' : state.lastRefresh ? `Оновлено ${new Date(state.lastRefresh).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}` : state.awaitingLogin ? 'Очікуємо на вхід' : 'Готовий до підключення';
  $('refresh').disabled = state.busy || state.demo;
  const key = JSON.stringify([state.parcels, state.connected, state.awaitingLogin, state.error, state.notifications, showCompleted, selectedDirection]);
  if (key !== contentKey) {
    contentKey = key;
    const scroll = document.querySelector('.parcel-scroll')?.scrollTop || 0;
    if (!state.parcels.length && !state.connected) {
      $('content').innerHTML = `<section class="onboarding"><p class="eyebrow">ВАША ДОСТАВКА, ПОРУЧ</p><h1>Посилки.<br>Під контролем.</h1><p class="intro">Увійдіть до Нової пошти — і відстежуйте<br>свої посилки просто з робочого столу.</p><div class="benefit"><div class="bell-circle">${icon('bell')}</div><div><strong>Статус змінився? Ви знатимете.</strong><p>Перевірка кожні 5 хвилин,<br>поки комп’ютер не спить.</p></div></div><button id="signin" class="primary-button wide">${state.awaitingLogin ? 'Продовжити вхід' : 'Увійти за номером телефону'}${icon('arrow')}</button><button class="text-button manual-add" data-add>або додати посилку за ТТН</button>${state.error ? `<p class="error" role="alert">${escape(state.error)}</p>` : ''}</section>`;
    } else {
      const tabOf = p => p.direction === 'outgoing' ? 'outgoing' : 'incoming';
      const parcels = state.parcels.filter(p => tabOf(p) === selectedDirection);
      const active = parcels.filter(p => !['9','10','11'].includes(p.code));
      const visible = showCompleted ? parcels : active;
      const tabs = [['incoming','Отримання','↙'],['outgoing','Відправлення','↗']].map(([direction,label,arrow]) => `<button data-direction="${direction}" aria-pressed="${direction === selectedDirection}" class="direction-tab ${direction === selectedDirection ? 'selected' : ''}"><span>${arrow}</span>${label}<span class="tab-count">${state.parcels.filter(p => tabOf(p) === direction && !['9','10','11'].includes(p.code)).length}</span></button>`).join('');
      $('content').innerHTML = `<div class="list-heading"><h1>${selectedDirection === 'outgoing' ? 'Відправлення' : 'Отримання'}</h1><button class="icon-button" data-add aria-label="Додати ТТН" title="Додати ТТН">${icon('plus')}</button></div><div class="direction-tabs" role="group" aria-label="Напрямок посилок">${tabs}</div><div class="list-subheading"><span class="connection">${icon(state.connected ? 'shield' : 'box')}${state.connected ? 'Акаунт підключено' : 'Відстеження за ТТН'}</span><button id="show-completed" class="text-button">${showCompleted ? 'Лише активні' : 'Усі посилки'}</button></div>${state.error ? `<p class="error list-error" role="alert">${escape(state.error)}</p>` : ''}<div class="parcel-scroll">${visible.length ? visible.map(card).join('') : `<div class="empty">${icon('tray')}<strong>${selectedDirection === 'outgoing' ? 'Відправлених посилок поки немає' : 'Посилок до вас поки немає'}</strong><p>Нові посилки з’являться після перевірки.<br>Також можна додати ТТН вручну.</p></div>`}</div>${!state.notifications ? '<button id="enable-notifications" class="enable-notifications">Увімкнути сповіщення про зміни</button>' : ''}`;
      document.querySelector('.parcel-scroll').scrollTop = scroll;
    }
  }
  if (shouldReveal) document.querySelector(`[data-parcel-id="${reveal.id}"]`)?.scrollIntoView({block:'start'});
  $('account-label').textContent = state.connected ? 'Акаунт Нової пошти підключено' : 'Акаунт не підключено';
  $('account-open').textContent = state.connected ? 'Відкрити акаунт' : 'Увійти за телефоном';
  $('account-signout').hidden = !state.connected;
  $('setting-pin').checked = state.pinned;
  $('setting-notifications').checked = state.notifications;
  $('setting-notifications').disabled = !state.notificationSupported || state.demo;
  $('setting-autostart').checked = state.loginAtLaunch;
  $('setting-autostart').disabled = !state.canAutoStart;
  $('autostart-hint').hidden = state.canAutoStart;
  $('notification-test').disabled = state.demo;
  $('account-open').disabled = state.demo; $('account-signout').disabled = state.demo;
  $('add-submit').disabled = state.busy || state.demo;
  $('version').textContent = `Nova Parcel ${state.version}`;
}
if (!window.nova) {
  $('content').innerHTML = '<p class="error">Відкрийте застосунок Nova Parcel.</p>';
} else {
  const api = window.nova;
  api.subscribe(render);
  run(async () => { render(await api.state()); api.ready(); });
  $('pin').onclick = () => run(() => api.preferences({pinned:!current.pinned}));
  $('settings').onclick = () => $('settings-dialog').showModal();
  $('refresh').onclick = () => run(() => api.refresh());
  $('hide').onclick = () => run(() => api.hide());
  $('minimize').onclick = () => run(() => api.minimize());
  $('quit').onclick = () => run(() => api.quit());
  $('account-open').onclick = () => { $('settings-dialog').close(); run(() => api.signIn()); };
  $('account-signout').onclick = () => run(() => api.signOut());
  $('setting-pin').onchange = event => run(() => api.preferences({pinned:event.target.checked}));
  $('setting-autostart').onchange = event => run(() => api.preferences({loginAtLaunch:event.target.checked}));
  $('setting-notifications').onchange = event => run(() => api.preferences({notifications:event.target.checked}));
  $('notification-test').onclick = () => run(async () => { $('notification-result').textContent = await api.testNotification(); });
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close]'); if (close) $(close.dataset.close).close();
    if (event.target.closest('[data-add]')) { $('add-error').hidden = true; $('add-form').reset(); $('parcel-direction').value = selectedDirection; $('add-dialog').showModal(); }
    if (event.target.closest('#signin')) run(() => api.signIn());
    if (event.target.closest('#show-completed')) { showCompleted = !showCompleted; render(current); }
    if (event.target.closest('#enable-notifications')) run(async () => { await api.preferences({notifications:true}); toast('Сповіщення про зміни ввімкнено'); });
    const tab = event.target.closest('[data-direction]'); if (tab) { selectedDirection = tab.dataset.direction; render(current); document.querySelector('.parcel-scroll').scrollTop = 0; }
    const copy = event.target.closest('[data-copy]'); if (copy) run(async () => { await api.copy(copy.dataset.copy); toast('ТТН скопійовано'); });
  });
  $('add-form').onsubmit = event => {
    event.preventDefault(); $('add-error').hidden = true; $('add-submit').disabled = true;
    run(async () => {
      const result = await api.add({ number:$('tracking-number').value, title:$('parcel-title').value, direction:$('parcel-direction').value });
      if (result.ok) {
        const number = $('tracking-number').value.replace(/[\s-]/g, '');
        const added = current.parcels.find(p => p.id === number);
        selectedDirection = added?.direction || $('parcel-direction').value;
        if (added && ['9','10','11'].includes(added.code)) showCompleted = true;
        $('add-dialog').close(); render(current);
      }
      else { $('add-error').textContent = result.error || 'Не вдалося додати посилку.'; $('add-error').hidden = false; }
    }).finally(() => { $('add-submit').disabled = current.busy || current.demo; });
  };
}
