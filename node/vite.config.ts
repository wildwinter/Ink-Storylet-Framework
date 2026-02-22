import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        lib: {
            entry: {
                StoryletManager: resolve(__dirname, 'src/StoryletManager.ts'),
                StoryletRunner: resolve(__dirname, 'src/StoryletRunner.ts')
            },
            // Formats are overridden by rollupOptions.output
            formats: ['es', 'cjs']
        },
        rollupOptions: {
            // Externalize built-ins and dependencies
            external: [
                'inkjs',
                'inklecate',
                'fs',
                'path',
                'events',
                'url'
            ],
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
