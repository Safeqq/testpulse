/** Contoh unggah laporan JUnit; URL berasal dari origin halaman sehingga benar di lingkungan mana pun. */
export function curlExample(slug: string, token: string): string {
  return [
    `curl -X POST "${window.location.origin}/api/v1/projects/${slug}/runs?branch=main" \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/xml" \\`,
    `  --data-binary @junit.xml`,
  ].join("\n");
}
