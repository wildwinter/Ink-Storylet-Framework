import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
    plugins: [
        dts({
            insertTypesEntry: true,
            outDir: 'build/es',
            // It will generate types in build/es. 
            // `package.json` "types" points to "./build/es/StoryletManager.d.ts"
        })
    ],
    build: {
        lib: {
            entry: {
                StoryletManager: resolve(__dirname, 'src/StoryletManager.ts'),
                StoryletRunner: resolve(__dirname, 'src/StoryletRunner.ts')
            }
        },
        rollupOptions: {
            external: ['inkjs', 'inklecate'],
            output: [
                {
                    format: 'es',
                    dir: 'build/es',
                    entryFileNames: '[name].js'
                },
                {
                    format: 'cjs',
                    dir: 'build/cjs',
                    entryFileNames: '[name].js'
                }
            ]
        },
        outDir: 'build',
        emptyOutDir: true
    }
});
