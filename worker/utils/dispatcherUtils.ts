/**
 * Dispatcher Utility Functions
 *
 * Shared utilities for checking dispatch namespace availability and handling
 * Workers for Platforms functionality across the application.
 */

type EnvWithDispatcher = Env & { DISPATCHER: DispatchNamespace };

export function isDispatcherAvailable(env: Env): env is EnvWithDispatcher {
    // Check if DISPATCHER binding exists in the environment
    // This will be false if dispatch_namespaces is commented out in wrangler.jsonc
    // or if Workers for Platforms is not enabled for the account (as binding would be removed by the deploy.ts script)
    return 'DISPATCHER' in env && env.DISPATCHER != null;
}