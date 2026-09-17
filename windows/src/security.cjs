'use strict';
function officialURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['novaposhta.ua', 'novapost.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
function cabinetURL(value) {
  try { return new URL(value).origin === 'https://new.novaposhta.ua'; } catch { return false; }
}
function trustedSender(event, contents, expectedURL) {
  return !!contents && !contents.isDestroyed() && event.sender === contents &&
    event.senderFrame === contents.mainFrame && event.senderFrame?.url === expectedURL;
}
module.exports = { officialURL, cabinetURL, trustedSender };
