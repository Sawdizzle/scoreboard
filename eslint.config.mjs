import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A form action's first argument is the previous state; most ignore it.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // lib/rules is Scoreboard's engine, copied unchanged; it is linted there.
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'lib/rules/**', 'lib/fx/**', 'public/**'] },
];

export default config;
