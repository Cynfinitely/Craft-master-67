import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Cream, orange, and brown from the chosen palette. Token names stay `forge`.
        forge: {
          bg: "#FDFBD4",
          panel: "#FFFDE8",
          panel2: "#F6EBB8",
          border: "#D3BF94",
          gold: "#713600",
          goldbright: "#38240D",
          // Secondary text; solid so it keeps ≥4.5:1 on every cream surface.
          muted: "#7A4E22",
          rust: {
            DEFAULT: "#C05800",
            // Rust dark enough for small text (≥4.5:1 on panel2).
            strong: "#A34A00",
          },
        },
        affix: {
          prefix: "#713600",
          suffix: "#A34A00",
        },
        rarity: {
          normal: "#38240D",
          magic: "#3146c9",
          rare: "#A34A00",
          unique: "#713600",
          currency: "#38240D",
        },
        // Semantic feedback tones; fg passes AA on its own bg and on the creams.
        success: { fg: "#2F6B1F", bg: "#E6F0D2", border: "#A9C78F" },
        warn: { fg: "#8A5300", bg: "#FBE7B5", border: "#E0B55E" },
        danger: { fg: "#A1261B", bg: "#F8DCD3", border: "#E0A090" },
        info: { fg: "#1F5A8A", bg: "#DDEAF2", border: "#9FC0D8" },
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
