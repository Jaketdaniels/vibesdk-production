// import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';

import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
// import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vite.dev/config/
export default defineConfig({
	optimizeDeps: {
		exclude: ['format', 'editor.all'],
		include: [
			'monaco-editor/esm/vs/editor/editor.api',
			'react',
			'react-dom',
			'react-router',
		],
		holdUntilCrawlEnd: false,
	},
	plugins: [
		react(),
		svgr(),
		cloudflare({
			configPath: 'wrangler.jsonc',
			experimental: { remoteBindings: true },
		}), // Add the node polyfills plugin here
		// nodePolyfills({
		//     exclude: [
		//       'tty', // Exclude 'tty' module
		//     ],
		//     // We recommend leaving this as `true` to polyfill `global`.
		//     globals: {
		//         global: true,
		//     },
		// })
		tailwindcss(),
		// sentryVitePlugin({
		// 	org: 'cloudflare-0u',
		// 	project: 'javascript-react',
		// }),
	],

	resolve: {
		alias: {
			// 'path': 'path-browserify',
			// Add this line to fix the 'debug' package issue
			debug: 'debug/src/browser',
			// "@": path.resolve(__dirname, "./src"),
			'@': path.resolve(__dirname, './src'),
            'shared': path.resolve(__dirname, './shared'),
            'worker': path.resolve(__dirname, './worker'),
		},
	},

	// Configure for Prisma + Cloudflare Workers compatibility
	define: {
		// Ensure proper module definitions for Cloudflare Workers context
		'process.env.NODE_ENV': JSON.stringify(
			process.env.NODE_ENV || 'development',
		),
		global: 'globalThis',
		// '__filename': '""',
		// '__dirname': '""',
	},

	worker: {
		// Handle Prisma in worker context for development
		format: 'es',
	},

	server: {
		allowedHosts: true,
	},

	cacheDir: '.cache/vite',

	build: {
		sourcemap: 'hidden',
		chunkSizeWarningLimit: 1000,
		minify: 'esbuild',
		target: 'es2022',
		cssMinify: 'esbuild',
		cssCodeSplit: true,
		rollupOptions: {
			output: {
				manualChunks(id): string | undefined {
					if (id.includes('node_modules')) {
						if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
							return 'vendor-react';
						}
						if (id.includes('@radix-ui')) {
							return 'vendor-ui';
						}
						if (id.includes('monaco-editor')) {
							return 'vendor-monaco';
						}
						if (id.includes('date-fns') || id.includes('clsx') || id.includes('tailwind-merge')) {
							return 'vendor-utils';
						}
						if (id.includes('@sentry')) {
							return 'vendor-sentry';
						}
						if (id.includes('hono')) {
							return 'vendor-hono';
						}
					}
					return undefined;
				},
			},
			treeshake: {
				moduleSideEffects: 'no-external',
				propertyReadSideEffects: false,
				unknownGlobalSideEffects: false,
			},
		},
	},
});
