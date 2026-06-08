import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Path of Exile inspired palette
        forge: {
          bg: "#0d0c0a",
          panel: "#17150f",
          panel2: "#1f1c14",
          border: "#3a3526",
          gold: "#c8aa6e",
          goldbright: "#e6c989",
          rust: "#a65a2e",
        },
        affix: {
          prefix: "#8aa9ff",
          suffix: "#ff9a6e",
        },
        rarity: {
          normal: "#c8c8c8",
          magic: "#8888ff",
          rare: "#ffff77",
          unique: "#af6025",
          currency: "#aa9e82",
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
