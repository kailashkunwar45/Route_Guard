/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0f172a",
        primary: "#2563eb",
        surface: "#ffffff",
        canvas: "#f3f4f6",
        risk: {
          low: "#1b9e77",
          moderate: "#d95f02",
          high: "#7570b3",
          severe: "#e7298a",
          notravel: "#000000",
          unknown: "#9ca3af",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
