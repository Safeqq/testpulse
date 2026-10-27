// Menerapkan tema sebelum bundle aplikasi dimuat agar tidak ada kedip (flash). Skrip klasik tanpa impor, dimuat
// sinkron di <head>; bukan inline karena CSP `script-src 'self'`.
// Logikanya harus identik dengan parsePreference + resolveTheme + applyTheme di src/lib/theme.ts
// (dijaga oleh test/unit/theme-init.test.ts); warna meta theme-color = THEME_COLORS.
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

  // Warna chrome browser (address bar mobile) mengikuti tema sebelum React dimuat; sama dengan THEME_COLORS di theme.ts.
  try {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0d0f" : "#f4f5f7");
  } catch {
    // Tanpa elemen meta: abaikan.
  }
})();
