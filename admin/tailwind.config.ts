import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#F4ECDF",
          soft:   "#FBF6EC",
          deep:   "#EBE0CC",
          dark:   "#DFD2B8",
        },
        ink: {
          DEFAULT: "#1A1714",
          soft:    "#3A332C",
          mute:    "#6E6358",
        },
        gold: {
          DEFAULT: "#B98238",
          warm:    "#C99A55",
          deep:    "#8E5F22",
          glow:    "#E9C887",
        },
        sage: "#6F8470",
      },
      fontFamily: {
        serif: ['"Fraunces"', '"Cormorant Garamond"', "Georgia", "serif"],
        sans:  ['"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        sm: "0 1px 2px rgba(26,23,20,.04), 0 2px 8px rgba(26,23,20,.04)",
        md: "0 6px 24px rgba(26,23,20,.06), 0 2px 8px rgba(26,23,20,.04)",
        lg: "0 30px 80px -20px rgba(26,23,20,.18), 0 10px 30px -10px rgba(26,23,20,.10)",
      },
    },
  },
  plugins: [],
} satisfies Config;
