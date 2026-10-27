// Menerapkan tema sebelum bundle aplikasi dimuat agar tidak ada kedip (flash). Skrip klasik tanpa impor, dimuat
// sinkron di <head>; bukan inline karena CSP `script-src 'self'`.
// Logikanya harus identik dengan parsePreference + resolveTheme + applyTheme di src/lib/theme.ts
// (dijaga oleh test/unit/theme-init.test.ts).
(function () {
  var pref = "system";
  try {
    var raw = window.localStorage.getItem("tp-theme");
    if (raw === "light" || raw === "dark" || raw === "system") pref = raw;
  } catch {
    // Penyimpanan diblokir: perlakukan sebagai "system".
  }

  var systemDark = false;
  try {
    systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    // matchMedia tidak tersedia: anggap terang.
  }

  var theme = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  var root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
})();
