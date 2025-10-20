# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React+Vite frontend with Cloudflare Workers backend that features a Durable Object-based AI agent capable of building webapps phase-wise from user prompts.

**Tech Stack:**
- Frontend: React 19, Vite, Tailwind v4, React Router
- Backend: Cloudflare Workers, Hono web framework
- Database: D1 (SQLite) with Drizzle ORM
- Durable Objects: CodeGeneratorAgent, UserAppSandboxService
- Storage: R2 buckets (templates)
- Execution: Cloudflare Containers via `@cloudflare/sandbox`

**Development Status:** Active development - not production ready. All features are work-in-progress.

## Development Commands

### Frontend Development
```bash
bun run dev              # Start Vite dev server with hot reload
bun run build            # Build production frontend
bun run lint             # Run ESLint
bun run preview          # Preview production build
```

### Worker Development
```bash
wrangler dev             # Run Worker locally with Wrangler
bun run cf-typegen       # Generate TypeScript types for CF bindings
bun run deploy           # Deploy to Cloudflare Workers + secrets
```

### Database (D1)
```bash
bun run db:generate              # Generate migrations (local)
bun run db:generate:remote       # Generate migrations (remote)
bun run db:migrate:local         # Apply migrations locally
bun run db:migrate:remote        # Apply migrations to production
bun run db:studio                # Open Drizzle Studio for local DB
bun run db:drop                  # Drop local database
bun run db:check                 # Check migration status
```

### Testing
```bash
bun run test             # Run Vitest tests
bun run test:watch       # Run tests in watch mode
bun run test:coverage    # Generate coverage report
```

### Code Quality
```bash
bun run scan             # Run anti-pattern scan (detects common issues)
```

## Development Status

**All features are work-in-progress. Nothing is production-ready yet.**

### Authentication System (Active Development)
Current work:
- ✅ Passkey/WebAuthn implementation
- 🚧 UI polish and user flows
- 🚧 Test coverage
- 🚧 BYOK (Bring Your Own Keys) - partially implemented
- ✅ OAuth 2.0 (Google, GitHub) with PKCE
- ✅ JWT sessions with refresh tokens
- ✅ Email verification with OTPs

**Location:** `worker/api/controllers/auth/controller.ts`, `worker/api/routes/authRoutes.ts`

### Database Architecture (Active Development)
- Using Drizzle ORM with D1 (SQLite)
- Schema: `worker/database/schema.ts`
- Migrations: `migrations/` directory
- Migration workflow needs refinement

### Testing (In Progress)
- Framework: Vitest (not Jest)
- Existing tests: SCOF parser, diff formats (comprehensive unit tests)
- Missing: Integration tests, E2E tests for generation workflow
- Goal: Comprehensive test coverage

## Code Patterns (Follow These When Writing Code)

### TypeScript Strictness
- **Never use `any`** - Find proper types or create them
- **No dynamic imports** - Use static imports only
- **Strict mode** - All code must pass `tsc -b` with strict checks
- Find type definitions in existing code before creating new ones

### DRY Principle (CRITICAL)
Before creating new utilities/components/functions:
1. Search `worker/agents/domain/pure/` for pure functions
2. Search `worker/agents/utils/` for utilities
3. Search `worker/agents/operations/` for operation patterns
4. Search `src/components/` for UI components
5. Only create new if genuinely novel

**Why:** Preventing duplication is more important than speed. Always research first.

### Architecture Patterns in Use

**Operations Pattern** (`worker/agents/operations/`):
Each AI operation is a separate, testable class:
- `PhaseGenerationOperation` - Generate implementation phases
- `PhaseImplementationOperation` - Generate code for phase
- `CodeReviewOperation` - Review and fix errors
- `SmartCodeReviewOperation` - Quality improvements (smart mode only)
- `FileRegenerationOperation` - Regenerate specific files
- `ScreenshotAnalysisOperation` - Analyze UI screenshots
- `UserConversationProcessor` - Handle user feedback

Pattern: Each operation has `execute()` method, returns typed result.

**Service Interfaces** (`worker/agents/services/interfaces/`):
- `ICodingAgent` - Agent contract
- `IStateManager` - State management abstraction
- `IFileManager` - File operations abstraction

Use interfaces for dependency injection and testing.

**Value Objects** (`worker/agents/domain/values/`):
- `IssueReport` - Immutable error report
- `GenerationContext` - Immutable generation settings
- Validated on construction, no setters

**Pure Functions** (`worker/agents/domain/pure/`):
- `FileProcessing` - File manipulation without side effects
- `DependencyManagement` - Dependency resolution logic

### Agent State Machine

Current state flow (see `worker/agents/core/state.ts`):
```
IDLE → PHASE_GENERATING → PHASE_IMPLEMENTING → REVIEWING → FINALIZING
                                                   ↓
                                          FILE_REGENERATING (if errors)
                                                   ↓
                                          back to REVIEWING
```

When working on agent code, respect state transitions.

### Cloudflare Constraints (CRITICAL)

**Durable Objects** (uses `agents` npm library):
- State must be JSON-serializable
- CPU limit: 30 seconds per request
- No filesystem access
- WebSocket connections: maintain with ping/pong
- State persistence is automatic

**D1 Database (SQLite)**:
- **Always batch operations** - D1 performance depends on batching
- **Always index foreign keys** - N+1 queries kill performance
- Use cursor pagination, not offset (for large datasets)
- Prepared statements only (Drizzle handles this)

Example batch pattern:
```typescript
await db.batch([
  db.insert(users).values(newUser),
  db.insert(sessions).values(newSession)
]);
```

**Workers Limits**:
- CPU time: 50ms free tier, 30s paid
- Memory: 128MB per request
- Subrequests: 50 max (includes D1 queries!)
- WebSocket message size: 1MB limit

### Project-Specific Patterns

**WebSocket Protocol:**
- Client: `src/routes/chat/hooks/use-chat.ts`
- Server: `worker/agents/core/websocket.ts`
- Message types: `worker/agents/constants.ts` → `WebSocketMessageResponses`
- Always use typed messages from constants

**Sandbox Execution (Cloudflare Containers):**
- Service: `worker/services/sandbox/sandboxSdkClient.ts`
- Uses `@cloudflare/sandbox` npm package
- Access via `env.Sandbox` (Durable Object binding)
- Instance allocation: `MANY_TO_ONE` or `ONE_TO_ONE`
- Configuration: `wrangler.jsonc` containers section

**AI Model Configuration:**
- `InferenceContext` type for per-operation settings (`worker/agents/inferutils/config.types.ts`)
- User overrides stored in `user_model_configs` table
- Each operation (PhaseGeneration, CodeReview, etc.) has configurable model
- Models can route through Cloudflare AI Gateway or direct to providers

## Working with This Codebase

### Core Architecture: Phase-wise Code Generation

The system generates webapps in phases using a Durable Object-based agent:

1. **Blueprint Phase**: Analyzes user requirements and creates project blueprint
2. **Incremental Generation**: Generates code phase-by-phase with specific files per phase
3. **SCOF Protocol**: Structured Code Output Format for streaming generated code
4. **Review Cycles**: Multiple automated review passes:
   - Static analysis (linting, type checking)
   - Runtime validation via Sandbox Service
   - AI-powered error detection and fixes
5. **Diff Support**: Efficient file updates using unified diff format

### Agent Architecture

```
Agent<Env, CodeGenState> (from 'agents' npm library)
  └── SimpleCodeGeneratorAgent (deterministic mode)
       └── SmartCodeGeneratorAgent (smart mode + CRITIC pattern)
```

**SimpleCodeGeneratorAgent** (`worker/agents/core/simpleGeneratorAgent.ts`):
- Base implementation, deterministic orchestration
- Orchestrates: Phase generation → Implementation → Review → Fix errors
- Used when `agentMode === 'deterministic'`

**SmartCodeGeneratorAgent** (`worker/agents/core/smartGeneratorAgent.ts`):
- Extends SimpleCodeGeneratorAgent
- Adds quality enhancement cycle after error fixes
- Applies CRITIC pattern for complexity reduction
- Only active when `agentMode === 'smart'`

### Key Components

- **Durable Object**: `worker/agents/core/smartGeneratorAgent.ts` - Stateful code generation
- **State Management**: `worker/agents/core/state.ts` - Generation state tracking
- **WebSocket Protocol**: `worker/agents/core/websocket.ts` - Real-time streaming
- **Sandbox Service**: `worker/services/sandbox/sandboxSdkClient.ts` - Code execution

### Frontend-Worker Communication

- **Initial Request**: POST `/api/agent`
- **WebSocket Connection**: `/api/agent/:agentId/ws` for real-time updates
- **Message Types**: Typed protocol for file updates, errors, phase transitions
- **Handler**: `src/routes/chat/hooks/use-chat.ts`
- **Message Processing**: `src/routes/chat/utils/handle-websocket-message.ts`

### Key Dependencies

- **agents** - npm package providing Durable Object abstractions for AI agents
- **@cloudflare/sandbox** - Cloudflare Containers for isolated code execution
- **drizzle-orm** - Type-safe database ORM for D1
- **hono** - Ultrafast web framework for Workers
- **zod** - Runtime validation and type inference

### Common File Locations

- Agent core: `worker/agents/core/`
- Operations: `worker/agents/operations/`
- Domain logic: `worker/agents/domain/`
- Services: `worker/services/`
- Database schema: `worker/database/schema.ts`
- API routes: `worker/api/routes/`
- API controllers: `worker/api/controllers/`
- Frontend: `src/routes/`
- UI components: `src/components/`

## Common Tasks

### Debugging Code Generation

1. Run local worker: `wrangler dev`
2. Check WebSocket messages in browser DevTools
3. Review state transitions in `CurrentDevState` enum
4. Check Durable Object logs in wrangler output

### Working with Durable Objects

- Core agent: `worker/agents/core/smartGeneratorAgent.ts`
- Binding: `env.CodeGenObject` (see `wrangler.jsonc`)
- State type: `CodeGenState` (exported from agent)
- Uses `agents` npm library for base functionality

### Database Migrations

```bash
# Local development
bun run db:generate              # Create migration from schema changes
bun run db:migrate:local         # Apply migrations locally
bun run db:studio                # Open Drizzle Studio to view data

# Production
bun run db:generate:remote       # Create migration for remote
bun run db:migrate:remote        # Apply to production D1
```

### Sandbox Service Integration

- Client: `worker/services/sandbox/sandboxSdkClient.ts`
- Provides: Isolated code execution, live previews, command execution
- Binding: `env.Sandbox` (Durable Object)
- Configuration: See `wrangler.jsonc` containers section

### Adding Features to Code Generation

1. Modify agent logic in `worker/agents/core/smartGeneratorAgent.ts` or `simpleGeneratorAgent.ts`
2. Add new operations in `worker/agents/operations/` (follow existing patterns)
3. Update state types in `worker/agents/core/state.ts` if needed
4. Add new message types in `worker/agents/constants.ts` for WebSocket
5. Update frontend handler in `src/routes/chat/hooks/use-chat.ts`

## Important Notes

### Development Principles

- **DRY is CRITICAL** - Always research existing code before creating new patterns
- **TypeScript strict mode** - Never use `any` type, find or create proper types
- **No dynamic imports** - Use static imports only
- **Implement correctly, not quickly** - Quality over speed
- **Cloudflare-native** - Prioritize D1, Durable Objects, R2, Containers
- **Batch D1 operations** - Essential for performance
- **Respect Cloudflare limits** - CPU time, memory, subrequests

### Code Quality Standards

- Comments should explain code, not changes
- No emojis in code (enforced by `bun run scan`)
- Use ES modules, not CommonJS
- Fix existing files instead of rewriting them
- Professional, maintainable code

### Anti-Patterns (Detected by `bun run scan`)

- Hardcoded configuration (use environment variables)
- TODO/FIXME comments (implement or create issues)
- CommonJS syntax (use ES modules)
- Emojis in code
- `any` type usage
- Hardcoded URLs or API keys

### Environment Variables

Required in `.dev.vars` for local development:
- AI provider keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_STUDIO_API_KEY`
- OAuth credentials (Google, GitHub)
- JWT secret: `JWT_SECRET`

See `.dev.vars.example` for complete list.
