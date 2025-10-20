import ora, { Ora } from 'ora';
import pc from 'picocolors';

/**
 * Modern, professional build logger with static spinners and in-place updates
 * Uses ora for elegant terminal spinners and grouped output sections
 */
export class BuildLogger {
	private spinner: Ora | null = null;
	private stepStartTime: number = 0;
	private deploymentStartTime: number;
	private currentStep: number = 0;
	private totalSteps: number = 0;

	constructor(totalSteps: number = 8) {
		this.deploymentStartTime = Date.now();
		this.totalSteps = totalSteps;
	}

	/**
	 * Start a new step with a spinner
	 */
	startStep(message: string): void {
		this.currentStep++;
		this.stepStartTime = Date.now();

		// Stop previous spinner if exists
		if (this.spinner) {
			this.spinner.stop();
		}

		const stepPrefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);
		this.spinner = ora({
			text: `${stepPrefix} ${message}`,
			spinner: 'dots',
			color: 'cyan',
		}).start();
	}

	/**
	 * Update the current spinner text
	 */
	updateStep(message: string): void {
		if (this.spinner) {
			const stepPrefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);
			this.spinner.text = `${stepPrefix} ${message}`;
		}
	}

	/**
	 * Complete the current step successfully
	 */
	completeStep(message?: string): void {
		if (this.spinner) {
			const duration = this.formatDuration(Date.now() - this.stepStartTime);
			const stepPrefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);
			const finalMessage = message || this.spinner.text.replace(stepPrefix, '').trim();

			this.spinner.succeed(`${stepPrefix} ${finalMessage} ${pc.dim(`(${duration})`)}`);
			this.spinner = null;
		}
	}

	/**
	 * Mark the current step as failed
	 */
	failStep(message: string, error?: Error): void {
		if (this.spinner) {
			const stepPrefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);
			this.spinner.fail(`${stepPrefix} ${message}`);

			if (error) {
				console.error(pc.dim(`   ${error.message}`));
			}

			this.spinner = null;
		}
	}

	/**
	 * Skip the current step with a warning
	 */
	skipStep(message: string, reason?: string): void {
		if (this.spinner) {
			const stepPrefix = pc.dim(`[${this.currentStep}/${this.totalSteps}]`);
			this.spinner.warn(`${stepPrefix} ${message}`);

			if (reason) {
				console.log(pc.dim(`   ${reason}`));
			}

			this.spinner = null;
		}
	}

	/**
	 * Log an info message without spinner
	 */
	info(message: string, indent: boolean = false): void {
		const prefix = indent ? '   ' : '';
		console.log(`${prefix}${pc.blue('ℹ')} ${pc.dim(message)}`);
	}

	/**
	 * Log a success message without spinner
	 */
	success(message: string, indent: boolean = false): void {
		const prefix = indent ? '   ' : '';
		console.log(`${prefix}${pc.green('✓')} ${message}`);
	}

	/**
	 * Log a warning message without spinner
	 */
	warn(message: string, indent: boolean = false): void {
		const prefix = indent ? '   ' : '';
		console.log(`${prefix}${pc.yellow('⚠')} ${message}`);
	}

	/**
	 * Log an error message without spinner
	 */
	error(message: string, indent: boolean = false): void {
		const prefix = indent ? '   ' : '';
		console.error(`${prefix}${pc.red('✖')} ${message}`);
	}

	/**
	 * Log section header
	 */
	section(title: string): void {
		console.log(`\n${pc.cyan(pc.bold(title))}`);
	}

	/**
	 * Log deployment summary header
	 */
	header(message: string): void {
		const line = '─'.repeat(60);
		console.log(`\n${pc.cyan(line)}`);
		console.log(pc.cyan(pc.bold(message)));
		console.log(`${pc.cyan(line)}\n`);
	}

	/**
	 * Log final deployment success
	 */
	deploymentSuccess(domain: string): void {
		const totalDuration = this.formatDuration(Date.now() - this.deploymentStartTime);
		const line = '═'.repeat(60);

		console.log(`\n${pc.green(line)}`);
		console.log(pc.green(pc.bold('🎉 Deployment Successful!')));
		console.log(pc.green(line));
		console.log(`\n${pc.bold('Live at:')} ${pc.cyan(pc.underline(`https://${domain}`))}`);
		console.log(`${pc.dim('Duration:')} ${totalDuration}\n`);
	}

	/**
	 * Log final deployment failure
	 */
	deploymentFailure(error: string): void {
		const line = '═'.repeat(60);

		console.error(`\n${pc.red(line)}`);
		console.error(pc.red(pc.bold('✖ Deployment Failed')));
		console.error(`${pc.red(line)}\n`);
		console.error(pc.red(error));

		console.error(`\n${pc.bold('Troubleshooting:')}`);
		console.error(pc.dim('  • Verify all environment variables are set correctly'));
		console.error(pc.dim('  • Check Cloudflare API token permissions'));
		console.error(pc.dim('  • Ensure Workers for Platforms is enabled'));
		console.error(pc.dim('  • Verify templates repository accessibility'));
		console.error(pc.dim('  • Confirm bun and build tools are installed\n'));
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
		if (this.spinner) {
			this.spinner.stop();
			this.spinner = null;
		}
	}
}
