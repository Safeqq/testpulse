import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "./args.js";

const TOKEN = "tp_" + "A".repeat(43);
const ENV = { TESTPULSE_TOKEN: TOKEN };
const BASE = ["--url", "https://pulse.example.com", "--project", "testpulse", "--branch", "main", "a.xml"];

function usageMessage(argv: string[], env: NodeJS.ProcessEnv = ENV): string {
  try {
    parseArgs(argv, env);
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);
    return (err as UsageError).message;
  }
  throw new Error("parseArgs seharusnya melempar UsageError");
}

describe("parseArgs", () => {
  it("membaca semua opsi, file, dan token dari env", () => {
    const opts = parseArgs(
      [
        "--url", "https://pulse.example.com/",
        "--project", "testpulse",
        "--branch", "feat/x",
        "--commit", "abc1234",
        "--ci-url", "https://ci.example.com/run/1",
        "--name", "unit",
        "a.xml",
        "reports/*.xml",
      ],
      ENV,
    );
    expect(opts).toEqual({
      url: "https://pulse.example.com",
      project: "testpulse",
      branch: "feat/x",
      commit: "abc1234",
      ciUrl: "https://ci.example.com/run/1",
      name: "unit",
      files: ["a.xml", "reports/*.xml"],
      token: TOKEN,
    });
  });

  it("opsi opsional tidak ada di hasil bila tidak diberikan", () => {
    const opts = parseArgs(BASE, ENV);
    expect(opts).not.toHaveProperty("commit");
    expect(opts).not.toHaveProperty("ciUrl");
    expect(opts).not.toHaveProperty("name");
  });

  it("mempertahankan path dasar pada --url (tanpa garis miring akhir)", () => {
    const opts = parseArgs(["--url", "https://host.example.com/pulse//", ...BASE.slice(2)], ENV);
    expect(opts.url).toBe("https://host.example.com/pulse");
  });

  it.each([
    ["--url", "--url wajib diisi"],
    ["--project", "--project wajib diisi"],
    ["--branch", "--branch wajib diisi"],
  ])("%s wajib", (flag, expected) => {
    const argv = [...BASE];
    const i = argv.indexOf(flag);
    argv.splice(i, 2);
    expect(usageMessage(argv)).toContain(expected);
  });

  it("minimal satu file atau pola wajib", () => {
    expect(usageMessage(BASE.slice(0, -1))).toContain("berkas");
  });

  it("TESTPULSE_TOKEN wajib dan tidak boleh kosong", () => {
    expect(usageMessage(BASE, {})).toContain("TESTPULSE_TOKEN");
    expect(usageMessage(BASE, { TESTPULSE_TOKEN: "   " })).toContain("TESTPULSE_TOKEN");
  });

  it("token dengan bentuk salah ditolak tanpa mengulang nilainya", () => {
    for (const bad of ["tp_pendek", "x".repeat(46), `tp_${"A".repeat(44)}`, `tp_${"A".repeat(42)}!`, `Bearer ${TOKEN}`]) {
      const message = usageMessage(BASE, { TESTPULSE_TOKEN: bad });
      expect(message).toContain("TESTPULSE_TOKEN");
      expect(message).not.toContain(bad);
    }
  });

  it("menolak URL yang bukan http(s) atau memuat kredensial", () => {
    expect(usageMessage(["--url", "ftp://x.example.com", ...BASE.slice(2)])).toContain("--url");
    expect(usageMessage(["--url", "bukan-url", ...BASE.slice(2)])).toContain("--url");
    expect(usageMessage(["--url", "https://user:pw@x.example.com", ...BASE.slice(2)])).toContain("username");
  });

  it("opsi tidak dikenal ditolak tanpa mengulang nilainya (tidak ada flag token)", () => {
    const message = usageMessage([...BASE, `--token=${TOKEN}`]);
    expect(message).toContain("--token");
    expect(message).not.toContain(TOKEN);
  });

  it("opsi tanpa nilai ditolak", () => {
    expect(usageMessage(["--url", "https://x.example.com", "--project"])).toContain("--project");
  });
});
