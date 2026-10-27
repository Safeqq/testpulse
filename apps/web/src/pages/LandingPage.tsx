import { useEffect } from "react";
import { Features } from "./landing/Features";
import { Footer } from "./landing/Footer";
import { Hero } from "./landing/Hero";
import { HowItWorks } from "./landing/HowItWorks";
import { Quality } from "./landing/Quality";
import { Roadmap } from "./landing/Roadmap";

export const LANDING_TITLE = "TestPulse — Pantau kesehatan testing tim Anda";

/** Landing page untuk pengunjung anonim di `/` (spec §6). */
export function LandingPage() {
  // Judul khusus landing (bukan format "<halaman> · TestPulse"); dikembalikan saat landing ditinggalkan.
  useEffect(() => {
    const previous = document.title;
    document.title = LANDING_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-16 sm:gap-20">
      <Hero />
      <Features />
      <HowItWorks />
      <Quality />
      <Roadmap />
      <Footer />
    </div>
  );
}
