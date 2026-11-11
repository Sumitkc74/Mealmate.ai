/** @type {import('tailwindcss').Config} */
//
// MealMate design system — inspired by Anthropic / Claude's warm,
// editorial palette. Cream canvas, deep ink type, terracotta accent.
// The `brand` scale is the accent itself so every existing
// `bg-brand-*` / `text-brand-*` utility re-themes automatically.
//
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Page surfaces: warm non-white neutral tone
        canvas: '#FAF7F2',
        'canvas-soft': '#F4EFE6',
        card: '#FFFDF9',

        // Ink (text): deep warm charcoal/umber
        ink: '#24211D',
        'ink-soft': '#544E45',
        'ink-mute': '#7D7569',

        // Hairlines / crisp dividers
        line: '#E5DFD3',
        'line-strong': '#CCC4B4',

        // Terracotta accent: single intentional accent color
        brand: {
          50: '#FBF1EC',
          100: '#F4DDD0',
          200: '#EBC2AB',
          300: '#DDA382',
          400: '#CC8662',
          500: '#BD6D49',
          600: '#A85638',
          700: '#8C4528',
          800: '#6E3520',
          900: '#4F261A',
        },

        // Auxiliary sage for pantry freshness indicators
        sage: {
          50: '#EFF3EC',
          100: '#D8E2D2',
          500: '#7E956C',
          600: '#5F7752',
          700: '#475A3D',
        },
      },
      fontFamily: {
        serif: ['"Fraunces"', '"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(36, 33, 29, 0.04)',
        ring: '0 0 0 1px rgba(36, 33, 29, 0.06)',
      },
      borderRadius: {
        sm: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
      },
    },
  },
  plugins: [],
};
