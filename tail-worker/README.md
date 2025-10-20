# Tail Worker - Log Monitoring

This tail worker receives and processes logs from the main `vibesdk-production` worker for monitoring and debugging purposes.

## Setup

### 1. Deploy the Tail Worker

```bash
cd tail-worker
wrangler deploy
```

### 2. Connect it to the Main Worker

After deploying, connect the tail worker to your main worker:

```bash
# From the project root
wrangler tail vibesdk-production --format json | wrangler tail send vibesdk-production-tail
```

Or use the persistent tail connection:

```bash
wrangler tail vibesdk-production --format pretty
```

### 3. Configure Automatic Tailing (Optional)

To automatically send logs from your main worker to this tail worker on every request:

```bash
# Connect the tail worker to the main worker
wrangler tail vibesdk-production --format json --tail-consumer vibesdk-production-tail
```

## Features

- **Error Tracking**: Automatically logs all exceptions and errors
- **Warning Detection**: Captures warning-level logs for potential issues
- **Performance Monitoring**: Tracks CPU and memory exceeded events
- **Request Context**: Includes URL, method, and timestamp for each event

## Viewing Logs

### Real-time Logs (Local Development)

```bash
# View logs from the main worker
wrangler tail vibesdk-production

# View logs from the tail worker itself
wrangler tail vibesdk-production-tail
```

### Production Logs via Logpush

Since `logpush: true` is enabled in the main worker, logs are automatically sent to Cloudflare's Logpush service. You can configure where these logs are sent:

```bash
# List current logpush jobs
wrangler logpush list

# Create a new logpush job (example: send to R2)
wrangler logpush create --destination-conf "r2://your-bucket/logs"
```

## Customization

### Send to External Monitoring Service

Uncomment and configure the external monitoring section in `index.ts` (lines 70-90) to send logs to:

- Sentry
- Datadog
- New Relic
- Custom webhook endpoint

Example for Sentry:

```typescript
if (event.outcome === 'exception') {
	await fetch('https://your-sentry-instance.ingest.sentry.io/api/YOUR_PROJECT_ID/store/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Sentry-Auth': 'Sentry sentry_key=YOUR_KEY, sentry_version=7'
		},
		body: JSON.stringify({
			message: event.exceptions[0]?.message,
			level: 'error',
			platform: 'javascript',
			timestamp: event.eventTimestamp / 1000,
			exception: {
				values: event.exceptions
			}
		})
	});
}
```

## Filtering Logs

You can modify the tail worker to filter specific log levels or patterns:

```typescript
// Only process errors and warnings, ignore info/debug
const relevantLogs = event.logs.filter(
	log => log.level === 'error' || log.level === 'warn'
);
```

## Cost Considerations

Tail workers are included in your Workers subscription. However, if you're sending logs to external services, be mindful of:

1. **Request costs**: Each external fetch counts toward your Workers request limit
2. **Egress costs**: Data sent to external services may incur bandwidth charges
3. **External service costs**: Check pricing for services like Sentry, Datadog, etc.

## Troubleshooting

### Tail worker not receiving logs

1. Verify the tail worker is deployed: `wrangler deployments list --name vibesdk-production-tail`
2. Check the connection: `wrangler tail vibesdk-production` should show logs
3. Ensure `logpush: true` is set in the main worker's `wrangler.jsonc`

### Too many logs

If you're getting overwhelmed with logs, add filtering in the tail worker:

```typescript
// Only log errors from specific routes
if (event.event.request?.url?.includes('/api/agent') && event.outcome === 'exception') {
	console.error('Agent API Error:', event);
}
```

## Documentation

- [Cloudflare Tail Workers](https://developers.cloudflare.com/workers/observability/tail-workers/)
- [Cloudflare Logpush](https://developers.cloudflare.com/logs/get-started/enable-destinations/)
- [Workers Observability](https://developers.cloudflare.com/workers/observability/)
