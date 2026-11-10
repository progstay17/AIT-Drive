// Applies the saved theme before first paint (avoids a light/dark flash).
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) { /* storage unavailable: follow system theme */ }
})();
