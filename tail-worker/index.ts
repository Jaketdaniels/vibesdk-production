/**
 * Tail Worker for VibeSDK Production
 *
 * This worker receives logs from the main worker and processes them for monitoring.
 * It can filter, aggregate, and send logs to external monitoring services.
 */

interface TailEvent {
	outcome: 'ok' | 'exception' | 'exceededCpu' | 'exceededMemory' | 'unknown' | 'canceled';
	scriptName: string;
	exceptions: Array<{
		name: string;
		message: string;
		timestamp: number;
	}>;
	logs: Array<{
		message: string;
		level: 'log' | 'debug' | 'info' | 'warn' | 'error';
		timestamp: number;
	}>;
	eventTimestamp: number;
	event: {
		request?: {
			url: string;
			method: string;
			headers: Record<string, string>;
		};
	};
}

interface Env {
	// Add any environment bindings here if needed
	// For example, if you want to send logs to a KV store or external service
}

export default {
	async tail(events: TailEvent[], env: Env, ctx: ExecutionContext) {
		// Process each event
		for (const event of events) {
			try {
				// Log errors with more detail
				if (event.outcome === 'exception' || event.outcome === 'exceededCpu' || event.outcome === 'exceededMemory') {
					console.error('Worker Error:', {
						outcome: event.outcome,
						scriptName: event.scriptName,
						timestamp: new Date(event.eventTimestamp).toISOString(),
						url: event.event.request?.url,
						method: event.event.request?.method,
						exceptions: event.exceptions,
					});
				}

				// Log all errors from the main worker
				const errorLogs = event.logs.filter(log => log.level === 'error');
				if (errorLogs.length > 0) {
					console.error('Application Errors:', {
						scriptName: event.scriptName,
						timestamp: new Date(event.eventTimestamp).toISOString(),
						url: event.event.request?.url,
						errors: errorLogs.map(log => ({
							message: log.message,
							timestamp: new Date(log.timestamp).toISOString(),
						})),
					});
				}

				// Log warnings for potential issues
				const warnLogs = event.logs.filter(log => log.level === 'warn');
				if (warnLogs.length > 0) {
					console.warn('Application Warnings:', {
						scriptName: event.scriptName,
						timestamp: new Date(event.eventTimestamp).toISOString(),
						url: event.event.request?.url,
						warnings: warnLogs.map(log => ({
							message: log.message,
							timestamp: new Date(log.timestamp).toISOString(),
						})),
					});
				}

				// Optional: Send to external monitoring service
				// You can uncomment and configure this to send logs to services like:
				// - Sentry
				// - Datadog
				// - New Relic
				// - Custom webhook endpoint
				/*
				if (event.outcome === 'exception') {
					await fetch('https://your-monitoring-service.com/logs', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': 'Bearer YOUR_API_KEY'
						},
						body: JSON.stringify({
							service: event.scriptName,
							timestamp: event.eventTimestamp,
							level: 'error',
							message: event.exceptions[0]?.message,
							url: event.event.request?.url,
							exceptions: event.exceptions,
						})
					});
				}
				*/
			} catch (error) {
				// Don't let tail worker errors affect the main worker
				console.error('Error in tail worker:', error);
			}
		}
	},
};
