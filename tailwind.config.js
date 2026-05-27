import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    path.resolve(__dirname, './index.html'),
    path.resolve(__dirname, './src/**/*.{js,jsx}'),
  ],
  theme: {
    extend: {
      colors: {
        'brand-blue': '#0052cc',
        'brand-blue-hover': '#0747a6',
        'brand-navy': '#091e42',
        'brand-slate': '#42526e',
        'brand-gray-light': '#f4f5f7',
        'brand-border': '#dfe1e6',
        'brand-hover': '#ebecf0',
      },
    },
  },
  plugins: [],
}
