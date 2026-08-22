/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Cairo', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          50: '#eef6ff', 100: '#d9eaff', 200: '#bcdbff', 300: '#8ec2ff',
          400: '#599eff', 500: '#3278fc', 600: '#1c56f1', 700: '#1441de',
          800: '#1736b4', 900: '#18338d', 950: '#132154',
        },
      },
    },
  },
  plugins: [],
};
