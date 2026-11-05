// Applies the saved theme before first paint (avoids a light/dark flash).
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: follow system theme */ }
})();
