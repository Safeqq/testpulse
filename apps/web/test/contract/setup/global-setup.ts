import { rm } from "node:fs/promises";
import { PACT_FILE } from "../pact.js";

/** Menghapus file pact lama agar interaksi yang sudah dihapus dari test tidak ikut ter-merge. */
export default async function setup(): Promise<void> {
  await rm(PACT_FILE, { force: true });
}
