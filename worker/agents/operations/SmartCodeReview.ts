import { AgentOperation, OperationOptions, getSystemPromptWithProjectContext } from './common';
import { IssueReport } from '../domain/values/IssueReport';
import { createUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { GenerationContext } from '../domain/values/GenerationContext';
import { PROMPT_UTILS } from '../prompts';
import z from 'zod';

/**
 * Schema for smart code review output
 * Focuses on quality improvements beyond error-fixing
 */
export const SmartCodeReviewOutput = z.object({
    enhancementsFound: z.boolean().describe('Whether any quality enhancements were identified'),

    systematicPatterns: z.array(z.object({
        pattern: z.string().describe('Description of the recurring pattern needing improvement across multiple files'),
        affectedFiles: z.array(z.string()).describe('All file paths exhibiting this pattern'),
        enhancement: z.string().describe('Detailed, actionable fix to apply systematically across all affected files'),
        category: z.enum(['complexity_reduction', 'ux_improvement', 'pattern_simplification']).describe('Primary category of this enhancement'),
        impact: z.enum(['high', 'medium', 'low']).describe('User-facing impact level'),
        effort: z.enum(['quick', 'moderate', 'complex']).describe('Estimated effort per file: quick (<5min), moderate (<15min), complex (>15min)'),
        risk: z.enum(['low', 'medium', 'high']).describe('Risk of breaking existing functionality'),
        batchId: z.string().describe('Unique identifier for parallel processing batch'),
    })).describe('Pattern-based enhancements for efficient batch processing (recommended for 15+ similar files)'),

    filesToEnhance: z.array(z.object({
        filePath: z.string().describe('Path to the file needing enhancement'),
        enhancements: z.array(z.string()).describe('List of specific, actionable quality improvements for this file with concrete examples'),
        category: z.enum(['complexity_reduction', 'ux_improvement', 'pattern_simplification']).describe('Primary enhancement category'),
        impact: z.enum(['high', 'medium', 'low']).describe('User-facing impact'),
        effort: z.enum(['quick', 'moderate', 'complex']).describe('Estimated enhancement effort'),
        risk: z.enum(['low', 'medium', 'high']).describe('Risk level'),
        requireCodeChanges: z.boolean().describe('Whether code changes are required (vs just suggestions)'),
    })).describe('Individual files needing unique enhancements that do not fit systematic patterns'),

    batchSummary: z.object({
        totalFiles: z.number().describe('Total number of files in the generated codebase'),
        filesNeedingEnhancement: z.number().describe('Number of files that need quality improvements'),
        systematicPatternsCount: z.number().describe('Number of recurring patterns identified'),
        highImpactCount: z.number().describe('Number of high-impact enhancements'),
        estimatedTotalEffort: z.enum(['quick', 'moderate', 'significant']).describe('Overall effort estimate for all enhancements'),
    }).describe('Summary metadata about the enhancement strategy'),
});

export type SmartCodeReviewOutputType = z.infer<typeof SmartCodeReviewOutput>;

export interface SmartCodeReviewInputs {
    issues: IssueReport;
}

const SYSTEM_PROMPT = `You are a Senior Code Quality Engineer at Cloudflare specializing in GENERATED web application enhancement for 2025.

## YOUR MISSION:
Systematically analyze AI-GENERATED codebases (10-100+ files) and identify quality improvements beyond error-fixing, using intelligent batching for scalable parallel execution.

## CONTEXT: AI-GENERATED CODE PATTERNS
The codebase was AI-GENERATED. Common issues in LLM-generated code:

**Over-Engineering:**
- Custom hooks wrapping simple useState/useEffect
- Unnecessary useCallback/useMemo (premature optimization)
- Complex state management (Context/Redux) for simple component-local UI state
- Over-abstracted components with too many layers

**Missing Polish (React 19, 2025 best practices):**
- No Suspense boundaries for async components (should wrap data fetching)
- Missing Error Boundaries (components crash entire app)
- No loading states or skeleton loaders
- No empty states (no UI when lists are empty)
- Missing interactive states (hover, focus, active effects)
- Accessibility gaps (missing aria-label, alt text, keyboard nav)

**Complexity Creep:**
- Nested if/else >3 levels deep (should use early returns/guard clauses)
- Duplicate logic copy-pasted across files (should extract to utils)
- Long functions >50 lines doing multiple things (should decompose)

**Tailwind CSS Issues (v4, 2025):**
- Hardcoded px values instead of responsive classes (should use sm:, md:, lg:, xl:, 2xl:)
- Missing mobile-first responsive design
- No hover/focus states on interactive elements
- Inconsistent spacing (should use Tailwind spacing scale)

## REACT 19 (2025) BEST PRACTICES TO CHECK:

### 1. Suspense & Async Rendering
Common Generated Pattern (BAD):
\`\`\`tsx
function UserList() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(setUsers).finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  return <div>{users.map(...)}</div>;
}
\`\`\`

2025 Best Practice (GOOD):
\`\`\`tsx
import { Suspense } from 'react';

function UserList() {
  const users = use(fetchUsers());
  return <div>{users.map(...)}</div>;
}

<Suspense fallback={<UserListSkeleton />}>
  <UserList />
</Suspense>
\`\`\`

### 2. Error Boundaries (React 19)
Missing (BAD):
\`\`\`tsx
<Dashboard />
\`\`\`

Required (GOOD):
\`\`\`tsx
<ErrorBoundary fallback={<ErrorPage />}>
  <Dashboard />
</ErrorBoundary>
\`\`\`

### 3. Complexity Reduction
Nested Hell (BAD):
\`\`\`tsx
function processData(data) {
  if (data) {
    if (data.isValid) {
      if (data.hasPermission) {
        return doWork(data);
      } else {
        return 'No permission';
      }
    } else {
      return 'Invalid';
    }
  } else {
    return 'No data';
  }
}
\`\`\`

Flattened (GOOD):
\`\`\`tsx
function processData(data) {
  if (!data) return 'No data';
  if (!data.isValid) return 'Invalid';
  if (!data.hasPermission) return 'No permission';
  return doWork(data);
}
\`\`\`

### 4. UX Polish (Tailwind CSS v4, 2025)
No Interactive States (BAD):
\`\`\`tsx
<button className="bg-blue-500 text-white px-4 py-2">
  Submit
</button>
\`\`\`

Polished (GOOD):
\`\`\`tsx
<button
  className="bg-blue-500 text-white px-4 py-2 rounded-lg
             hover:bg-blue-600 active:scale-95
             focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2
             disabled:opacity-50 disabled:cursor-not-allowed
             transition-all duration-150 ease-in-out
             sm:px-6 sm:py-3"
  aria-label="Submit form"
  disabled={isSubmitting}
>
  {isSubmitting ? 'Submitting...' : 'Submit'}
</button>
\`\`\`

### 5. Accessibility (WCAG 2025)
Required:
\`\`\`tsx
<img src={url} alt="User profile photo" />
<button aria-label="Close dialog"><XIcon /></button>
<div role="alert">{errorMessage}</div>
\`\`\`

## ENHANCEMENT CATEGORIES (Priority Order):

### 1. COMPLEXITY REDUCTION (High Priority)
Scan For:
- Functions with >3 levels of nesting
- Code duplicated across 3+ files
- Custom hooks that just wrap useState
- Unnecessary useCallback/useMemo without performance issues

Enhancements:
- Flatten nested conditionals using early returns
- Extract duplicated code to shared utils
- Inline over-engineered hooks
- Remove premature optimization

### 2. UX/UI POLISH (High Priority)
Scan For:
- Async components without Suspense
- Pages/components without ErrorBoundary
- Hardcoded px (should be responsive sm:, md:, lg:)
- Interactive elements without hover/focus states
- Missing aria-label, alt, role attributes
- Lists without empty states
- No loading skeletons

Enhancements:
- Add Suspense boundaries with skeleton fallbacks
- Wrap risky components in ErrorBoundary
- Replace px with responsive Tailwind classes
- Add hover:, focus:, active: states
- Add accessibility attributes
- Add empty state UI
- Add loading skeletons

### 3. PATTERN SIMPLIFICATION (Medium Priority)
Scan For:
- Context/Redux for component-local state
- Deep prop drilling (>2 levels)
- Over-abstracted component hierarchies
- Wrapper components adding no value

Enhancements:
- Use local state instead of global for isolated UI
- Simplify component composition
- Flatten component hierarchies
- Remove unnecessary indirection

## SCALE-AWARE ANALYSIS:

Small Codebases (1-20 files):
- Analyze ALL files individually
- Provide detailed enhancements for each

Medium Codebases (21-50 files):
- Quick categorization scan
- Deep analysis on HIGH-IMPACT files
- Pattern detection for similar files
- Batch similar enhancements

Large Codebases (51-100+ files):
- Critical path identification
- Systematic pattern detection
- Batch by component type
- Focus on highest ROI

## INTELLIGENT BATCHING:

Pattern-Based Batches (for 15+ similar files):
Group files with same issue, apply same fix to all in parallel

Individual Files (unique complex cases):
Provide detailed, specific enhancements for files that do not fit patterns

## CONSTRAINTS:

NEVER:
- Add new npm dependencies
- Change function signatures
- Modify exports/imports structure
- Add new features
- Break parallel execution

ALWAYS:
- Ensure each file's enhancements are self-contained
- Prioritize user-facing improvements
- Preserve all existing functionality
- Provide specific, actionable examples
- Group logically similar changes

${PROMPT_UTILS.COMMANDS}
${PROMPT_UTILS.COMMON_PITFALLS}
`;

const USER_PROMPT = `<SMART_QUALITY_REVIEW>

## CODEBASE CONTEXT

User Request: "{{query}}"

Blueprint Summary: {{blueprintSummary}}

Codebase Stats:
- Total Files: {{fileCount}}
- Size Category: {{sizeCategory}}
- Primary Tech: React 19, Tailwind CSS v4, TypeScript

Validation Status:
- Error-fixing review cycles: COMPLETED
- TypeScript errors: 0 (all fixed)
- Runtime errors: 0 (all fixed)
- Build: Passing

Your Task: Find QUALITY improvements beyond basic error-fixing

## CURRENT CODEBASE

<generated_files>
{{filesWithLineNumbers}}
</generated_files>

## ANALYSIS PROTOCOL

### Step 1: Scale Assessment

Based on {{fileCount}} files, use appropriate strategy:
- If < 20: Individual analysis
- If 20-50: Hybrid (patterns + individual)
- If 50+: Systematic batching

### Step 2: Pattern Detection

Scan ALL files for:

React 19 (2025) Patterns:
- Async data fetching without Suspense
- Components without ErrorBoundary
- useEffect with missing dependencies
- Over-use of useCallback/useMemo

Tailwind CSS v4 (2025) Patterns:
- Hardcoded px values
- No hover/focus/active states
- No mobile-first design
- Inconsistent spacing

Complexity Patterns:
- Nested if/else >3 levels
- Duplicate code in 3+ files
- Functions >50 lines
- Over-engineered custom hooks

Accessibility (WCAG 2.1+):
- Images without alt
- Buttons without aria-label
- Missing role attributes
- Forms without labels

### Step 3: Impact Prioritization

For each pattern, assess:
- Files affected
- User impact (high/medium/low)
- Effort per file (quick/moderate/complex)
- Risk (low/medium/high)

Priority:
- HIGH impact + LOW effort + LOW risk = DO FIRST
- HIGH impact + HIGH effort + LOW risk = INCLUDE
- LOW impact + HIGH effort = SKIP

### Step 4: Intelligent Batching

For patterns affecting 15+ files:
Create systematic batch with standardized fix

For unique complex files:
Provide individual detailed enhancements

### Step 5: Output Generation

Return SmartCodeReviewOutput with:
- systematicPatterns: Batched improvements
- filesToEnhance: Individual files
- batchSummary: Strategy metadata

Be thorough. Be specific. Be actionable.

</SMART_QUALITY_REVIEW>`;

const userPromptFormatter = (
    context: GenerationContext,
    filesContext: string,
    fileCount: number
): string => {
    const sizeCategory = fileCount < 20 ? 'small' : fileCount <= 50 ? 'medium' : 'large';
    const blueprintSummary = `${context.blueprint.title} - ${context.blueprint.description}`;

    return USER_PROMPT
        .replaceAll('{{query}}', context.query)
        .replaceAll('{{blueprintSummary}}', blueprintSummary)
        .replaceAll('{{fileCount}}', fileCount.toString())
        .replaceAll('{{sizeCategory}}', sizeCategory)
        .replaceAll('{{filesWithLineNumbers}}', filesContext);
};

export class SmartCodeReviewOperation extends AgentOperation<SmartCodeReviewInputs, SmartCodeReviewOutputType> {
    async execute(
        _inputs: SmartCodeReviewInputs,
        options: OperationOptions
    ): Promise<SmartCodeReviewOutputType> {
        const { env, logger, context, inferenceContext } = options;

        logger.info('Performing smart code quality review');

        const filesContext = this.getFilesContextWithLineNumbers(context);
        const fileCount = context.allFiles.length;

        const messages = [
            ...getSystemPromptWithProjectContext(SYSTEM_PROMPT, context),
            createUserMessage(userPromptFormatter(context, filesContext, fileCount)),
        ];

        try {
            const { object: reviewResult } = await executeInference({
                env,
                messages,
                schema: SmartCodeReviewOutput,
                agentActionName: 'smartCodeReview',
                context: inferenceContext,
                reasoning_effort: fileCount > 30 ? 'high' : 'medium',
            });

            if (!reviewResult) {
                throw new Error('Failed to get smart code review result');
            }

            logger.info('Smart review complete', {
                enhancementsFound: reviewResult.enhancementsFound,
                systematicPatterns: reviewResult.systematicPatterns?.length || 0,
                individualFiles: reviewResult.filesToEnhance.length,
                totalFilesAffected: reviewResult.batchSummary?.filesNeedingEnhancement || 0,
            });

            return reviewResult;
        } catch (error) {
            logger.error('Error during smart code review:', error);
            throw error;
        }
    }

    private getFilesContextWithLineNumbers(context: GenerationContext): string {
        return context.allFiles
            .map(file => {
                const lines = file.fileContents.split('\n');
                const numberedContent = lines
                    .map((line, idx) => `${(idx + 1).toString().padStart(4, ' ')}  ${line}`)
                    .join('\n');

                return `
FILE: ${file.filePath}
PURPOSE: ${file.filePurpose}

CONTENTS:
${numberedContent}

${'='.repeat(80)}
`;
            })
            .join('\n');
    }
}
