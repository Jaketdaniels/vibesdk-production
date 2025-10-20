/**
 * Bun test runner preload script
 * Registers happy-dom for DOM API support and sets up test environment
 * This file is loaded via bunfig.toml [test].preload before any tests run
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Register happy-dom globals synchronously (window, document, etc.)
GlobalRegistrator.register();

// Dynamically import setup after DOM globals are registered
// This ensures window is defined when setup.ts accesses it
await import('./setup');
