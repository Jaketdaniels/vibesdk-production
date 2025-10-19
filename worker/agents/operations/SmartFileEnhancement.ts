import { FileOutputType, FileGenerationOutputType } from '../schemas';
import { AgentOperation, OperationOptions } from './common';
import { RealtimeCodeFixer } from '../assistants/realtimeCodeFixer';
import { AGENT_CONFIG } from '../inferutils/config';

export interface SmartFileEnhancementInputs {
    file: FileOutputType;
    enhancements: string[];
    category: 'complexity_reduction' | 'ux_improvement' | 'pattern_simplification';
    effort: 'quick' | 'moderate' | 'complex';
}

const SYSTEM_PROMPT = `You are a Senior Software Engineer at Cloudflare specializing in React 19 (2025) code quality enhancements.

## CRITICAL MANDATE:
Apply SPECIFIC quality improvements while preserving ALL existing functionality. Follow 2025 best practices for React 19, Tailwind CSS v4, and TypeScript strict mode.

## CORE PRINCIPLES:
1. SURGICAL CHANGES ONLY - Minimal, targeted improvements
2. PRESERVE FUNCTIONALITY - Never break existing features
3. NO FEATURE ADDITIONS - Only enhance existing code
4. MAINTAIN INTERFACES - Keep all exports, imports, function signatures identical
5. 2025 STANDARDS - Apply latest React 19, Tailwind v4, accessibility best practices

## REACT 19 (2025) ENHANCEMENTS:

### Suspense & Async Rendering
When adding Suspense boundaries:
\`\`\`tsx
import { Suspense } from 'react';

<Suspense fallback={<ComponentNameSkeleton />}>
  <AsyncComponent />
</Suspense>
\`\`\`

### Error Boundaries
When adding ErrorBoundary:
\`\`\`tsx
import { ErrorBoundary } from 'react-error-boundary';

<ErrorBoundary fallback={<ErrorFallback />}>
  <RiskyComponent />
</ErrorBoundary>
\`\`\`

### Fix Infinite Loops
When fixing useEffect dependency arrays:
\`\`\`tsx
// BEFORE (infinite loop):
useEffect(() => {
  setState(newValue);
});

// AFTER (correct):
useEffect(() => {
  setState(newValue);
}, [dependencies]);
\`\`\`

## TAILWIND CSS V4 (2025) ENHANCEMENTS:

### Mobile-First Responsive Design
Replace hardcoded px with responsive classes:
\`\`\`tsx
// BEFORE:
<div className="w-500px p-20px">

// AFTER (mobile-first):
<div className="w-full p-4 sm:w-96 sm:p-6 md:p-8">
\`\`\`

### Interactive States
Add hover/focus/active states:
\`\`\`tsx
// BEFORE:
<button className="bg-blue-500 text-white px-4 py-2">

// AFTER (polished):
<button className="bg-blue-500 text-white px-4 py-2 rounded-lg
                   hover:bg-blue-600 focus:ring-2 focus:ring-blue-400
                   active:scale-95 transition-all duration-150">
\`\`\`

## COMPLEXITY REDUCTION:

### Flatten Nested Logic
Use early returns instead of nesting:
\`\`\`tsx
// BEFORE (nested):
function process(data) {
  if (data) {
    if (data.valid) {
      return doWork(data);
    } else {
      return handleInvalid();
    }
  } else {
    return handleNull();
  }
}

// AFTER (flattened):
function process(data) {
  if (!data) return handleNull();
  if (!data.valid) return handleInvalid();
  return doWork(data);
}
\`\`\`

### Remove Unnecessary Hooks
Inline over-engineered custom hooks:
\`\`\`tsx
// BEFORE (over-engineered):
const useCounter = (initial) => {
  const [count, setCount] = useState(initial);
  return { count, setCount };
};
const { count, setCount } = useCounter(0);

// AFTER (simplified):
const [count, setCount] = useState(0);
\`\`\`

## ACCESSIBILITY (WCAG 2.1+):

Add missing attributes:
\`\`\`tsx
<img src={url} alt="User profile photo" />
<button aria-label="Close dialog"><XIcon /></button>
<div role="alert">{errorMessage}</div>
\`\`\`

## UX IMPROVEMENTS:

### Loading States
\`\`\`tsx
{isLoading ? (
  <div className="animate-pulse">Loading...</div>
) : (
  <Content />
)}
\`\`\`

### Empty States
\`\`\`tsx
{items.length === 0 ? (
  <div className="text-gray-500 text-center py-8">
    No items yet. Add one above!
  </div>
) : (
  items.map(...)
)}
\`\`\`

## FORBIDDEN ACTIONS:
- Adding new npm dependencies
- Changing function signatures
- Modifying exports/imports structure
- Architectural refactoring
- Adding new features

## SAFETY VERIFICATION:
- Enhancement actually improves code quality
- No regression in existing functionality
- All existing patterns preserved
- Same component props and interfaces

Your goal: ENHANCE quality WITHOUT breaking anything.
`;

const USER_PROMPT = `<QUALITY_ENHANCEMENT>

## FILE CONTEXT

File Path: {{filePath}}
File Purpose: {{filePurpose}}
Enhancement Category: {{category}}
Effort Level: {{effort}}

## CURRENT FILE CONTENTS

<current_code>
{{fileContents}}
</current_code>

## SPECIFIC ENHANCEMENTS TO APPLY

<enhancements>
{{enhancements}}
</enhancements>

## ENHANCEMENT PROTOCOL

### Step 1: Validate Enhancements
- Confirm each enhancement applies to current code
- SKIP enhancements that do not match current state
- SKIP if changes would break functionality

### Step 2: Apply Surgical Improvements
- Make MINIMAL changes to achieve enhancement
- Preserve all existing functionality
- Keep same exports, imports, function signatures
- Follow 2025 best practices (React 19, Tailwind v4, WCAG 2.1+)

### Step 3: Quality Verification
- Ensure enhancements actually improve code quality
- Verify no functionality is broken
- Maintain all existing behavioral patterns
- Add proper TypeScript types (no any)

### Step 4: Output

Provide the complete enhanced file contents following the exact format expected by FileGenerationOutput schema.

</QUALITY_ENHANCEMENT>`;

const userPromptFormatter = (
    file: FileOutputType,
    enhancements: string[],
    category: string,
    effort: string
): string => {
    return USER_PROMPT
        .replaceAll('{{filePath}}', file.filePath)
        .replaceAll('{{filePurpose}}', file.filePurpose)
        .replaceAll('{{category}}', category)
        .replaceAll('{{effort}}', effort)
        .replaceAll('{{fileContents}}', file.fileContents)
        .replaceAll('{{enhancements}}', enhancements.map((e, i) => `${i + 1}. ${e}`).join('\n'));
};

export class SmartFileEnhancementOperation extends AgentOperation<SmartFileEnhancementInputs, FileGenerationOutputType> {
    async execute(
        inputs: SmartFileEnhancementInputs,
        options: OperationOptions
    ): Promise<FileGenerationOutputType> {
        const { file, enhancements, category, effort } = inputs;
        const { env, logger, context, inferenceContext } = options;

        logger.info(`Enhancing file for quality: ${file.filePath}`, { category, effort });

        const userPrompt = userPromptFormatter(file, enhancements, category, effort);

        const realtimeCodeFixer = new RealtimeCodeFixer(
            env,
            inferenceContext,
            false,
            undefined,
            AGENT_CONFIG.smartFileEnhancement,
            SYSTEM_PROMPT,
            userPrompt
        );

        const enhancedFile = await realtimeCodeFixer.run(
            file,
            {
                previousFiles: context.allFiles,
                query: context.query,
                template: context.templateDetails,
            },
            undefined,
            enhancements,
            3
        );

        logger.info(`File enhanced: ${file.filePath}`);

        return {
            ...enhancedFile,
            format: 'full_content' as const,
        };
    }
}
