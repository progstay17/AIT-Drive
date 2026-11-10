'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const token = location.pathname.split('/')[2] || '';
  const page = {
    state: $('share-state'), title: $('share-title'), message: $('share-message'),
    details: $('file-details'), name: $('file-name'), type: $('file-type'), size: $('file-size'),
    expiry: $('expiry-panel'), expiryStatus: $('expiry-status'), remaining: $('remaining-days'), date: $('expiry-date'),
    button: $('download-button'), note: $('download-note'), help: $('help-note'),
  };
  const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' });
  const bytes = (value) => {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1024) return value + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let n = value / 1024, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' ' + units[i];
  };
  function remainingText(ms) {
    if (ms <= 0) return 'Kedaluwarsa';
    const minutes = Math.max(1, Math.ceil(ms / 60000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return days + ' hari' + (hours ? ' ' + hours + ' jam' : '') + ' lagi';
    if (hours > 0) return hours + ' jam' + (mins ? ' ' + mins + ' menit' : '') + ' lagi';
    return mins + ' menit lagi';
  }
  function showUnavailable(state, message, expiresAt) {
    page.state.textContent = state === 'expired' ? 'LINK KEDALUWARSA' : 'LINK TIDAK TERSEDIA';
    page.title.textContent = state === 'expired' ? 'Masa berlaku sudah habis' : 'Link tidak dapat digunakan';
    page.message.textContent = message || 'Tautan ini tidak lagi dapat digunakan. Minta pemilik file membagikan link baru.';
    page.button.hidden = true;
    page.note.hidden = true;
    page.help.hidden = false;
    if (state === 'expired') {
      page.expiry.hidden = false;
      page.remaining.textContent = '0 hari tersisa';
      page.expiryStatus.lastChild.textContent = ' KEDALUWARSA';
      page.expiryStatus.classList.add('is-inactive');
      if (expiresAt) page.date.textContent = 'Berakhir pada ' + dateFormat.format(new Date(expiresAt));
    }
  }
  async function load() {
    if (!token) return showUnavailable('invalid', 'Tautan yang kamu buka tidak lengkap.');
    try {
      const response = await fetch('/s/' + encodeURIComponent(token) + '/info', { cache: 'no-store', credentials: 'omit' });
      const data = await response.json();
      if (!response.ok || data.status !== 'active') return showUnavailable(data.status || 'unavailable', data.message, data.expiresAt);
      page.state.textContent = 'LINK SIAP DIAKSES';
      page.title.textContent = 'File siap diunduh';
      page.message.textContent = 'File ini dibagikan melalui AIT Drive. Tekan tombol di bawah untuk memulai download.';
      page.name.textContent = data.name || 'File bersama';
      page.type.textContent = data.itemType === 'folder' ? 'Folder · ZIP' : 'File';
      page.size.textContent = data.size == null ? 'Dihitung saat download' : bytes(data.size);
      page.details.hidden = false;
      page.expiry.hidden = false;
      page.button.href = '/s/' + encodeURIComponent(token) + '/download';
      page.button.hidden = false;
      page.note.hidden = false;
      const updateCountdown = () => {
        const left = Number(data.expiresAt) - Date.now();
        page.remaining.textContent = remainingText(left);
        page.date.textContent = 'Berakhir pada ' + dateFormat.format(new Date(data.expiresAt));
        if (left <= 0) {
          page.button.hidden = true;
          page.note.hidden = true;
          page.expiryStatus.lastChild.textContent = ' KEDALUWARSA';
          page.expiryStatus.classList.add('is-inactive');
          page.state.textContent = 'LINK KEDALUWARSA';
          page.title.textContent = 'Masa berlaku sudah habis';
          page.message.textContent = 'Link ini sudah tidak bisa digunakan. Minta pemilik file membuat link baru.';
          page.help.hidden = false;
        }
      };
      updateCountdown();
      window.setInterval(updateCountdown, 30000);
    } catch {
      page.state.textContent = 'GAGAL MEMERIKSA LINK';
      page.title.textContent = 'Tidak dapat memuat informasi';
      page.message.textContent = 'Koneksi ke AIT Drive sedang bermasalah. Periksa koneksi internet lalu muat ulang halaman.';
      page.help.hidden = false;
    }
  }
  load();
})();
