import { terser } from 'rollup-plugin-terser'
import typescript from 'rollup-plugin-typescript2'

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/stream.min.js',
    format: 'umd',
    name: 'Stream',
  },
  plugins: [
    typescript({
      tsconfig: 'tsconfig.browser.json',
    }),
    terser(),
  ],
}
