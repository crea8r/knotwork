/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand colours — update when design is finalised
        brand: { 50: '#f0f9ff', 500: '#0ea5e9', 900: '#0c4a6e' },
      },
    },
  },
  plugins: [],
}
