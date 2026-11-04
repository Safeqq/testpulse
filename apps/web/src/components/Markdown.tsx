import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeMarkdownUrl } from "@/lib/markdown-url";

/**
 * Markdown aman (spec Tahap 3 §3.5): dirender menjadi elemen React, tanpa `rehype-raw`, sehingga HTML mentah tidak
 * pernah menjadi elemen DOM (react-markdown menampilkannya sebagai teks). URL disaring `safeMarkdownUrl`, gambar
 * dijadikan link (CSP `img-src 'self' data:` tidak boleh dilonggarkan), dan tidak ada atribut `style`.
 *
 * Berat (react-markdown + remark): impor hanya dari modul yang dimuat lazy supaya tidak masuk bundle utama.
 */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const text = (value: string): HastNode => ({ type: "text", value });

/**
 * Plugin rehype: `<img>` menjadi `<a href>` berisi teks alternatif (atau URL bila kosong). Gambar di dalam link
 * (mis. lencana `[![a](x)](y)`) hanya menyisakan teksnya agar tidak ada link bersarang. Berjalan sebelum
 * `urlTransform`, jadi `src` berbahaya tetap dibuang di langkah itu.
 */
function rehypeImagesAsLinks() {
  const visit = (node: HastNode, insideLink: boolean): void => {
    node.children?.forEach((child, index) => {
      if (child.type === "element" && child.tagName === "img") {
        const src = typeof child.properties?.src === "string" ? child.properties.src : "";
        const alt = typeof child.properties?.alt === "string" ? child.properties.alt : "";
        const label = text(alt || src || "Gambar");
        node.children![index] = insideLink
          ? label
          : { type: "element", tagName: "a", properties: { href: src }, children: [label] };
        return;
      }
      visit(child, insideLink || (child.type === "element" && child.tagName === "a"));
    });
  };
  return (tree: HastNode): void => visit(tree, false);
}

const FOCUSABLE_SCROLLER =
  "overflow-x-auto rounded-md focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden";

const ALIGN_CLASS: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" };

/** remark-gfm meratakan kolom lewat `style="text-align:…"`; atribut itu dibuang (CSP) dan diganti kelas. */
const alignOf = (style: unknown): string | undefined => {
  const value = (style as { textAlign?: unknown } | undefined)?.textAlign;
  return typeof value === "string" ? ALIGN_CLASS[value] : undefined;
};

const components: Components = {
  // Tanpa href (protokol tidak aman dibuang oleh `urlTransform`) teks tetap tampil sebagai teks biasa.
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-4">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Wadah yang bisa digulir harus bisa difokus agar pengguna keyboard dapat menggesernya (axe: scrollable-region-focusable).
  pre: ({ children }) => (
    <div className={FOCUSABLE_SCROLLER} tabIndex={0} role="region" aria-label="Blok kode">
      <pre>{children}</pre>
    </div>
  ),
  table: ({ children }) => (
    <div className={FOCUSABLE_SCROLLER} tabIndex={0} role="region" aria-label="Tabel">
      <table>{children}</table>
    </div>
  ),
  th: ({ style, children, colSpan, rowSpan }) => (
    <th className={alignOf(style)} colSpan={colSpan} rowSpan={rowSpan}>
      {children}
    </th>
  ),
  td: ({ style, children, colSpan, rowSpan }) => (
    <td className={alignOf(style)} colSpan={colSpan} rowSpan={rowSpan}>
      {children}
    </td>
  ),
  // Kotak centang daftar tugas GFM: tampilan saja (disabled), tetapi tetap perlu nama untuk pembaca layar.
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked ? "Selesai" : "Belum selesai"} />
    ) : null,
};

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm];
const rehypePlugins: Options["rehypePlugins"] = [rehypeImagesAsLinks];

// Tipografi lewat varian arbitrer pada wadah (tanpa plugin typography dan tanpa `style`).
const PROSE = [
  "min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]",
  "[&>*+*]:mt-3",
  "[&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold",
  "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li+li]:mt-1 [&_li:has(>input)]:list-none [&_li:has(>input)]:-ml-6",
  "[&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:border-border",
  "[&_pre]:min-w-max [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-background [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:[overflow-wrap:normal]",
  "[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-xs",
  "[&_table]:w-max [&_table]:min-w-full [&_table]:border-collapse [&_th]:border [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-semibold [&_td]:border [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_td]:[overflow-wrap:normal]",
].join(" ");

export function Markdown({ source }: { source: string }) {
  return (
    <div className={PROSE} data-testid="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={safeMarkdownUrl}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
