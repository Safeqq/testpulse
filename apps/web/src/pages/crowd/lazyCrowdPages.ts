import { lazy } from "react";

// Pemuat chunk halaman crowdtesting (area publik `/crowd`). Modul ini di bundle utama; halamannya dipecah per chunk.
const loadDirectory = () => import("./CrowdDirectoryPage").then((m) => ({ default: m.CrowdDirectoryPage }));
const loadLeaderboard = () => import("./CrowdLeaderboardPage").then((m) => ({ default: m.CrowdLeaderboardPage }));
const loadTester = () => import("./CrowdTesterPage").then((m) => ({ default: m.CrowdTesterPage }));
const loadMe = () => import("./CrowdMePage").then((m) => ({ default: m.CrowdMePage }));
const loadCycle = () => import("./CrowdCyclePage").then((m) => ({ default: m.CrowdCyclePage }));

export const CrowdDirectoryPage = lazy(loadDirectory);
export const CrowdLeaderboardPage = lazy(loadLeaderboard);
export const CrowdTesterPage = lazy(loadTester);
export const CrowdMePage = lazy(loadMe);
export const CrowdCyclePage = lazy(loadCycle);
