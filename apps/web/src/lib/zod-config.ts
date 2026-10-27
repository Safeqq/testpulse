import { config } from "zod";

// Zod menguji dukungan `new Function` untuk JIT; di bawah CSP tanpa unsafe-eval probe itu dilaporkan sebagai
// pelanggaran script-src walau error-nya ditelan. `jitless` melewati probe tersebut.
// Modul ini harus diimpor paling awal (sebelum @testpulse/shared), karena skema dibuat saat modul dimuat.
config({ jitless: true });
