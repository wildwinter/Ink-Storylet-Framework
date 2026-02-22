import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
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
