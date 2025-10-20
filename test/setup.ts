import { vi } from 'vitest';

// Mock common modules used across tests
vi.mock('@/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// Mock WebSocket for tests
global.WebSocket = vi.fn() as unknown as typeof WebSocket;
