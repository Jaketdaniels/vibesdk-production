/**
 * Custom environment type extensions
 * Extends the auto-generated Env from worker-configuration.d.ts
 * to include secrets and other runtime variables not in wrangler.jsonc
 */

declare global {
	namespace Cloudflare {
		interface Env {
			// Cloudflare Account & API
			CLOUDFLARE_ACCOUNT_ID?: string;
			CLOUDFLARE_API_TOKEN?: string;
			CLOUDFLARE_AI_GATEWAY_URL?: string;
			CLOUDFLARE_AI_GATEWAY_TOKEN?: string;

			// AI Provider API Keys
			GOOGLE_AI_STUDIO_API_KEY?: string;
			ANTHROPIC_API_KEY?: string;
			OPENAI_API_KEY?: string;
			SERPAPI_KEY?: string;

			// Sandbox Service (override literal types from wrangler.jsonc)
			SANDBOX_SERVICE_URL?: string;
			SANDBOX_SERVICE_API_KEY?: string;
			SANDBOX_SERVICE_TYPE?: string;
			ALLOCATION_STRATEGY?: 'many_to_one' | 'one_to_one' | string;
			USE_TUNNEL_FOR_PREVIEW?: string;

			// OAuth Providers
			GOOGLE_CLIENT_ID?: string;
			GOOGLE_CLIENT_SECRET?: string;
			GITHUB_CLIENT_ID?: string;
			GITHUB_CLIENT_SECRET?: string;
			GITHUB_EXPORTER_CLIENT_ID?: string;
			GITHUB_EXPORTER_CLIENT_SECRET?: string;

			// Security & Secrets
			JWT_SECRET?: string;
			SECRETS_ENCRYPTION_KEY?: string;
			AI_PROXY_JWT_SECRET?: string;

			// Email Service
			RESEND_API_KEY?: string;
			RESEND_FROM_EMAIL?: string;

			// Monitoring & Observability
			SENTRY_DSN?: string;
			CF_ACCESS_ID?: string;
			CF_ACCESS_SECRET?: string;

			// Environment
			ENVIRONMENT?: string;
			CUSTOM_PREVIEW_DOMAIN?: string;
		}
	}
}

export {};
