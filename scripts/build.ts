#!/usr/bin/env node

/**
 * Modern Build Script with Real-Time Output Processing
 *
 * Streams and formats build output from TypeScript and Vite:
 * - Shows actual build progress (chunking, importing, etc.)
 * - Cleans up verbose output
 * - Groups related messages
 * - Minimal, professional formatting
 */

import { spawn } from 'child_process';
import pc from 'picocolors';

interface BuildStep {
	name: string;
	command: string;
	args: string[];
}

const steps: BuildStep[] = [
	{
		name: 'Generating Cloudflare bindings types',
		command: 'wrangler',
		args: ['types', '--include-runtime', 'false'],
	},
	{
		name: 'Compiling TypeScript',
		command: 'tsc',
		args: ['-b'],
	},
	{
		name: 'Building frontend with Vite',
		command: 'vite',
		args: ['build'],
	},
];

let currentStep = 0;
const totalSteps = steps.length;
const buildStartTime = Date.now();

/**
 * Strip ANSI escape codes and emojis from text
 */
function stripAnsi(text: string): string {
	// Remove ANSI escape codes
	text = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
	text = text.replace(/\x1b\][0-9];[^\x07]*\x07/g, '');
	text = text.replace(/\[2K/g, '');

	// Remove common emojis
	text = text.replace(/[⛅️✨📣▲►✓]/g, '');

	return text.trim();
}

/**
 * Format and filter build output lines
 */
function formatBuildLine(line: string, stepName: string): string | null {
	line = stripAnsi(line);
	if (!line) return null;

	// Filter out noise
	if (
		line.startsWith('$') ||
		line.includes('deprecation') ||
		line.includes('DEPRECATED') ||
		line.match(/^\d+ warning/i) ||
		line === 'vite v' ||
		line.startsWith('transforming (') ||
		line.startsWith('transforming...') ||
		line.includes('update available') ||
		line.match(/^-+$/) ||
		line.includes('wrangler 4.')
	) {
		return null;
	}

	// Filter warnings we don't need
	if (
		line.includes('Processing wrangler.jsonc') ||
		line.includes('"unsafe" fields are experimental') ||
		line.includes('optimizeDeps.esbuildOptions') ||
		line.includes('esbuildOptions but this option is now deprecated')
	) {
		return null;
	}

	// Format Vite chunk output
	if (stepName.includes('Vite')) {
		// Chunk building messages
		if (line.includes('building SSR') || line.includes('building for production')) {
			return `  ${pc.dim(line)}`;
		}

		// Transformed modules count
		if (line.match(/^\d+ modules transformed/)) {
			return `  ${pc.dim(line)}`;
		}

		// Rendering chunks
		if (line.includes('rendering chunks')) {
			return `  ${pc.dim(line)}`;
		}

		// File output (dist/...)
		if (line.includes('dist/')) {
			// Extract just the file info without extra symbols
			const cleaned = line.replace(/^[→>-]\s*/, '');
			return `  ${pc.dim(cleaned)}`;
		}

		// Warnings about chunk size
		if (line.includes('Some chunks are larger') || line.includes('Consider:') || line.includes('Use build.')) {
			return null; // Filter chunk size warnings
		}

		if (line.includes('Adjust chunk size limit')) {
			return null;
		}
	}

	// Format TypeScript output
	if (stepName.includes('TypeScript')) {
		if (line.includes('error TS')) {
			return `  ${pc.red('x')} ${line}`;
		}
		if (line.includes('warning')) {
			return `  ${pc.yellow('!')} ${line}`;
		}
	}

	// Format wrangler types output
	if (stepName.includes('types')) {
		if (line.includes('Types written to')) {
			return `  ${pc.dim(line)}`;
		}
		if (line.includes('Remember to rerun')) {
			return null; // Skip reminder
		}
		if (line.includes('declare')) {
			return null; // Skip type declarations dump
		}
	}

	// Generic formatted line (but only if meaningful)
	if (line.length > 5 && !line.match(/^[{}\[\]]/)) {
		// Don't show raw type definitions or config dumps
		if (line.includes('interface') || line.includes('namespace') || line.match(/^\w+:/)) {
			return null;
		}
		return `  ${pc.dim(line)}`;
	}

	return null;
}

/**
 * Run a build step and stream output
 */
async function runStep(step: BuildStep): Promise<void> {
	currentStep++;
	const stepStartTime = Date.now();
	const prefix = pc.dim(`[${currentStep}/${totalSteps}]`);

	console.log(`${prefix} ${step.name}`);

	return new Promise((resolve, reject) => {
		const proc = spawn(step.command, step.args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let hadOutput = false;

		proc.stdout?.on('data', (data) => {
			const lines = data.toString().split('\n');
			for (const line of lines) {
				const formatted = formatBuildLine(line, step.name);
				if (formatted) {
					hadOutput = true;
					console.log(formatted);
				}
			}
		});

		proc.stderr?.on('data', (data) => {
			const lines = data.toString().split('\n');
			for (const line of lines) {
				const formatted = formatBuildLine(line, step.name);
				if (formatted) {
					hadOutput = true;
					console.log(formatted);
				}
			}
		});

		proc.on('close', (code) => {
			const duration = formatDuration(Date.now() - stepStartTime);
			const check = pc.green('>');

			if (code === 0) {
				console.log(
					`${check} ${prefix} ${step.name.replace(/ing$/, 'ed').replace(/Generat$/, 'Generated')} ${pc.dim(duration)}\n`,
				);
				resolve();
			} else {
				const cross = pc.red('x');
				console.error(
					`${cross} ${prefix} ${step.name} failed ${pc.dim(duration)}\n`,
				);
				reject(new Error(`${step.command} exited with code ${code}`));
			}
		});

		proc.on('error', (err) => {
			const cross = pc.red('x');
			console.error(`${cross} ${prefix} ${step.name} error: ${err.message}\n`);
			reject(err);
		});
	});
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	} else if (ms < 60000) {
		return `${(ms / 1000).toFixed(1)}s`;
	} else {
		const minutes = Math.floor(ms / 60000);
		const seconds = Math.floor((ms % 60000) / 1000);
		return `${minutes}m ${seconds}s`;
	}
}

/**
 * Main build function
 */
async function build() {
	const line = '-'.repeat(60);

	console.log(`\n${pc.dim(line)}`);
	console.log(`${' '.repeat(23)}${pc.bold('Building Project')}`);
	console.log(`${pc.dim(line)}\n`);

	try {
		for (const step of steps) {
			await runStep(step);
		}

		const totalDuration = formatDuration(Date.now() - buildStartTime);
		const successLine = '='.repeat(60);

		console.log(`${pc.dim(successLine)}`);
		console.log(`${pc.green('>')} ${pc.bold('Build completed')} ${pc.dim(totalDuration)}`);
		console.log(`${pc.dim(successLine)}\n`);
	} catch (error) {
		const errorLine = '='.repeat(60);
		console.error(`\n${pc.dim(errorLine)}`);
		console.error(`${pc.red('x')} ${pc.bold('Build failed')}`);
		console.error(`${pc.dim(errorLine)}\n`);

		if (error instanceof Error) {
			console.error(pc.red(error.message));
		}

		process.exit(1);
	}
}

build();
