#!/usr/bin/env node

/**
 * Modern Build Script with Static Spinners
 *
 * Provides a clean, professional build experience with:
 * - Static spinners (no line-by-line spam)
 * - In-place progress updates
 * - Step timing information
 * - Clean error reporting
 */

import { execSync } from 'child_process';
import { BuildLogger } from './build-logger.js';

const logger = new BuildLogger(3); // 3 build steps

try {
	logger.header('Building Project');

	// Step 1: Generate TypeScript types
	logger.startStep('Generating Cloudflare bindings types');
	try {
		execSync('wrangler types --include-runtime false', {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		logger.completeStep('Generated Cloudflare bindings types');
	} catch (error) {
		logger.failStep('Failed to generate types', error instanceof Error ? error : undefined);
		process.exit(1);
	}

	// Step 2: TypeScript compilation
	logger.startStep('Compiling TypeScript');
	try {
		execSync('tsc -b', {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		logger.completeStep('TypeScript compiled successfully');
	} catch (error) {
		logger.failStep('TypeScript compilation failed', error instanceof Error ? error : undefined);

		// Show actual errors
		if (error instanceof Error && 'stdout' in error) {
			const stdout = (error as any).stdout?.toString();
			const stderr = (error as any).stderr?.toString();
			if (stdout) console.error(stdout);
			if (stderr) console.error(stderr);
		}

		process.exit(1);
	}

	// Step 3: Vite build
	logger.startStep('Building frontend with Vite');
	try {
		execSync('vite build', {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		logger.completeStep('Frontend built successfully');
	} catch (error) {
		logger.failStep('Vite build failed', error instanceof Error ? error : undefined);

		// Show actual errors
		if (error instanceof Error && 'stdout' in error) {
			const stdout = (error as any).stdout?.toString();
			const stderr = (error as any).stderr?.toString();
			if (stdout) console.error(stdout);
			if (stderr) console.error(stderr);
		}

		process.exit(1);
	}

	// Success summary
	const line = '═'.repeat(60);
	console.log(`\n${line}`);
	console.log('Build completed successfully!');
	console.log(`${line}\n`);

} catch (error) {
	logger.stop();
	console.error('\nBuild failed:', error instanceof Error ? error.message : String(error));
	process.exit(1);
}
