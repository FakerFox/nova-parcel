// Local companion to the official Nova Poshta web cabinet.
// Credentials stay inside the official origin's WebKit storage. Only a minimal
// parcel snapshot and an account identifier leave the page. No write API calls.
window.novaParcelSync = async function (extraNumbers, previousAccount) {
    if (location.origin !== 'https://new.novaposhta.ua') return {kind: 'login'};
    const token = localStorage.getItem('access_token');
    if (!token) return {kind: 'login'};
    const expiry = Number(localStorage.getItem('expires_at') || 0);
    if (expiry && expiry < Date.now() + 30000) return {kind: 'expired'};
    let claims;
    try {
        const storedClaims = localStorage.getItem('id_token_claims_obj');
        if (storedClaims) claims = JSON.parse(storedClaims);
        else {
            const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
        }
    } catch (_) { return {kind: 'error', message: 'Не вдалося перевірити сесію. Увійдіть повторно.'}; }
    if (!claims.sub) return {kind: 'error', message: 'Сесія не містить ідентифікатора акаунта.'};
    const allowed = new Set(['getIncomingDocumentsByPhone', 'getOutgoingDocumentsByPhone', 'getStatusDocuments']);
    async function request(modelName, calledMethod, methodProperties) {
        if (!allowed.has(calledMethod)) throw Error('Недозволений запит.');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        try {
            const r = await fetch('https://api.novaposhta.ua/v2.0/json/', {
                method: 'POST', headers: {'Content-Type': 'application/json', 'TokenOAuth2': token},
                body: JSON.stringify({system: 'PA 3.0', modelName, calledMethod, methodProperties}),
                signal: controller.signal, credentials: 'omit'
            });
            if (r.status === 401 || r.status === 403) throw Error('SESSION_EXPIRED');
            if (!r.ok) throw Error('Сервіс Нової пошти тимчасово недоступний.');
            const body = await r.json();
            if (!body.success) {
                const errorText = (body.errors || []).join(' ');
                if (/token|auth|авторизац|сесі|access.denied/i.test(errorText)) throw Error('SESSION_EXPIRED');
                throw Error('Нова пошта не надала список посилок. Спробуйте відкрити кабінет.');
            }
            if (!Array.isArray(body.data)) throw Error('Формат відповіді Нової пошти змінився.');
            return body;
        } finally { clearTimeout(timeout); }
    }
    const pad = n => String(n).padStart(2, '0');
    const format = d => `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} 00:00:00`;
    const from = new Date(); from.setMonth(from.getMonth()-3);
    const to = new Date(); to.setMonth(to.getMonth()+1); to.setDate(to.getDate()+1);
    const numbers = new Map();
    const descriptions = new Map();
    function parcelDescription(row) {
        for (const value of [row.Description, row.CargoDescriptionString, row.CargoDescription, row.DescriptionOfCargo]) {
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }
    // Retain previously seen shipments so a move into the cabinet's archive does
    // not hide the final delivery transition from notifications.
    for (const number of (previousAccount === String(claims.sub) ? extraNumbers || [] : [])) if (/^\d{14}$/.test(number)) numbers.set(number, 'incoming');
    try {
        for (const [method, direction] of [['getIncomingDocumentsByPhone', 'incoming'], ['getOutgoingDocumentsByPhone', 'outgoing']]) {
            let complete = false;
            for (let page = 1; page <= 20; page++) {
                const body = await request('InternetDocument', method, {
                    DateFrom: format(from), DateTo: format(to), Page: page, Limit: 100,
                    SearchByCounterparties: null, iCounterparties: null
                });
                const list = body.data.length && Array.isArray(body.data[0].result) ? body.data.flatMap(group => group.result || []) : body.data;
                if (list.some(row => !row || !(row.Number || row.IntDocNumber || row.DocumentNumber))) throw Error('Формат списку посилок змінився.');
                for (const row of list) {
                    const number = String(row.Number || row.IntDocNumber || row.DocumentNumber || '');
                    if (/^\d{14}$/.test(number)) {
                        numbers.set(number, direction);
                        const description = parcelDescription(row);
                        if (description) descriptions.set(number, description);
                    }
                }
                const total = Number(body.info && body.info.totalCount);
                if (list.length < 100 || (Number.isFinite(total) && total > 0 && page * 100 >= total)) { complete = true; break; }
            }
            if (!complete) throw Error('Забагато посилок для однієї синхронізації.');
        }
        const entries = [...numbers.keys()];
        const rows = [];
        for (let start = 0; start < entries.length; start += 100) {
            const body = await request('TrackingDocument', 'getStatusDocuments', {
                Documents: entries.slice(start, start+100).map(DocumentNumber => ({DocumentNumber})), Language: 'UA'
            });
            for (const row of body.data) {
                const Number = String(row.Number || row.IntDocNumber || '');
                if (!numbers.has(Number)) continue;
                const minimal = {Number, direction: numbers.get(Number)};
                // The cabinet list often contains the sender's description,
                // while the tracking response omits it. Join by TTN before
                // reducing the payload to the fields needed by the widget.
                const description = descriptions.get(Number) || parcelDescription(row);
                if (description) minimal.Description = description;
                for (const key of ['Status','StatusCode','CitySender','WarehouseRecipient','RecipientAddress','CityRecipient','ScheduledDeliveryDate','CargoDescriptionString']) {
                    if (typeof row[key] === 'string' || typeof row[key] === 'number') minimal[key] = String(row[key]);
                }
                rows.push(minimal);
            }
        }
        return {kind: 'success', accountID: String(claims.sub), rows};
    } catch (e) {
        if (e.message === 'SESSION_EXPIRED') return {kind: 'expired'};
        return {kind: 'error', message: e.name === 'AbortError' ? 'Запит тривав надто довго. Спробуйте ще раз.' : e.message};
    }
};
