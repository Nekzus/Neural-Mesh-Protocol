/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "var(--border-subtle)",
        "border-muted": "var(--border-muted)",
        input: "var(--bg-surface-2)",
        ring: "hsl(199, 89%, 48%)",
        background: "var(--bg-canvas)",
        foreground: "#f4f4f5",
        primary: {
          DEFAULT: "hsl(199, 89%, 48%)", // Cyan
          foreground: "#000000",
        },
        secondary: {
          DEFAULT: "var(--bg-surface-2)",
          foreground: "#f4f4f5",
        },
        destructive: {
          DEFAULT: "hsl(346, 84%, 50%)", // Rose
          foreground: "#ffffff",
        },
        success: {
          DEFAULT: "hsl(142, 76%, 36%)", // Emerald
          foreground: "#ffffff",
        },
        warning: {
          DEFAULT: "hsl(38, 92%, 50%)", // Amber
          foreground: "#000000",
        },
        muted: {
          DEFAULT: "rgba(255, 255, 255, 0.4)",
          foreground: "#a1a1aa",
        },
        accent: {
          DEFAULT: "rgba(56, 189, 248, 0.15)",
          foreground: "#38bdf8",
        },
        card: {
          DEFAULT: "var(--bg-surface-1)",
          foreground: "#f4f4f5",
        },
        surface1: "var(--bg-surface-1)",
        surface2: "var(--bg-surface-2)",
        surface3: "var(--bg-surface-3)",
        editor: "var(--bg-editor)",
        tier1: "var(--bg-tier1)",
        tier2: "var(--bg-tier2)",
        tier3: "var(--bg-tier3)",
      },
      boxShadow: {
        card: "var(--card-shadow)",
      },
      borderRadius: {
        lg: "0.5rem",
        md: "calc(0.5rem - 2px)",
        sm: "calc(0.5rem - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "Outfit", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" }
        }
      },
      animation: {
        "fade-in-up": "fade-in-up 0.25s ease-out forwards"
      }
    },
  },
  plugins: [],
}
