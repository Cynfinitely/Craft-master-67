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
          rust: "#C05800",
        },
        affix: {
          prefix: "#713600",
          suffix: "#C05800",
        },
        rarity: {
          normal: "#38240D",
          magic: "#3146c9",
          rare: "#C05800",
          unique: "#713600",
          currency: "#38240D",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
