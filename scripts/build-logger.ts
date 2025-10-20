import pc from 'picocolors';

/**
 * Minimal, professional build logger - 2025 CLI best practices
 * ASCII-only output with static spinners and clean formatting
 * Inspired by Turborepo, Vercel CLI, and Next.js
 */
export class BuildLogger {
	private currentStep: number = 0;
	private totalSteps: number = 0;
	private stepStartTime: number = 0;
	private buildStartTime: number;
	private spinnerFrames = ['|', '/', '-', '\\'];
	private spinnerIndex = 0;
	private spinnerInterval: NodeJS.Timeout | null = null;
	private currentMessage: string = '';
	private isCI: boolean;

	constructor(totalSteps: number = 8) {
		this.buildStartTime = Date.now();
		this.totalSteps = totalSteps;
		this.isCI = process.env.CI === 'true' || !process.stdout.isTTY;
	}

	/**
	 * Start a new step with a spinner
	 */
	startStep(message: string): void {
		this.currentStep++;
		this.stepStartTime = Date.now();
		this.currentMessage = message;

		const prefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);

		if (this.isCI) {
			// CI environment: Just print the line
			process.stdout.write(`${prefix} ${message}...\n`);
		} else {
			// Interactive terminal: Use spinner
			this.startSpinner();
			this.updateSpinner();
		}
	}

	/**
	 * Start the spinner animation
	 */
	private startSpinner(): void {
		if (this.spinnerInterval) {
			clearInterval(this.spinnerInterval);
		}

		this.spinnerInterval = setInterval(() => {
			this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
			this.updateSpinner();
		}, 80);
	}

	/**
	 * Update the spinner display
	 */
	private updateSpinner(): void {
		if (this.isCI) return;

		const spinner = pc.cyan(this.spinnerFrames[this.spinnerIndex]);
		const prefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);

		// Clear line and write new content
		process.stdout.write(`\r\x1b[K${spinner} ${prefix} ${this.currentMessage}`);
	}

	/**
	 * Stop the spinner
	 */
	private stopSpinner(): void {
		if (this.spinnerInterval) {
			clearInterval(this.spinnerInterval);
			this.spinnerInterval = null;
		}
	}

	/**
	 * Complete the current step successfully
	 */
	completeStep(message?: string): void {
		this.stopSpinner();

		const duration = this.formatDuration(Date.now() - this.stepStartTime);
		const prefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);
		const finalMessage = message || this.currentMessage;
		const check = pc.green('>');

		if (this.isCI) {
			process.stdout.write(`${prefix} ${finalMessage} ${pc.dim(duration)}\n`);
		} else {
			// Clear the spinner line and write the completion
			process.stdout.write(`\r\x1b[K${check} ${prefix} ${finalMessage} ${pc.dim(duration)}\n`);
		}
	}

	/**
	 * Mark the current step as failed
	 */
	failStep(message: string, error?: Error): void {
		this.stopSpinner();

		const prefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);
		const cross = pc.red('x');

		if (this.isCI) {
			process.stderr.write(`${prefix} ${message}\n`);
		} else {
			process.stderr.write(`\r\x1b[K${cross} ${prefix} ${message}\n`);
		}

		if (error) {
			console.error(pc.dim(`   ${error.message}`));
		}
	}

	/**
	 * Log section header
	 */
	header(message: string): void {
		const width = 60;
		const padding = Math.max(0, Math.floor((width - message.length - 2) / 2));
		const line = '-'.repeat(width);

		console.log(`\n${pc.dim(line)}`);
		console.log(`${' '.repeat(padding)}${pc.bold(message)}`);
		console.log(`${pc.dim(line)}\n`);
	}

	/**
	 * Log build success
	 */
	buildSuccess(): void {
		const totalDuration = this.formatDuration(Date.now() - this.buildStartTime);
		const line = '='.repeat(60);

		console.log(`\n${pc.dim(line)}`);
		console.log(`${pc.green('>')} ${pc.bold('Build completed')} ${pc.dim(totalDuration)}`);
		console.log(`${pc.dim(line)}\n`);
	}

	/**
	 * Log build failure
	 */
	buildFailure(error: string): void {
		const line = '='.repeat(60);

		console.error(`\n${pc.dim(line)}`);
		console.error(`${pc.red('x')} ${pc.bold('Build failed')}`);
		console.error(`${pc.dim(line)}\n`);
		console.error(pc.red(error));
		console.error();
	}

	/**
	 * Format duration in human-readable format
	 */
	private formatDuration(ms: number): string {
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
	 * Stop any active spinner (cleanup)
	 */
	stop(): void {
		this.stopSpinner();
	}
}
