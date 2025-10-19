import { SimpleCodeGeneratorAgent } from './simpleGeneratorAgent';
import { SmartCodeReviewOperation } from '../operations/SmartCodeReview';
import { SmartFileEnhancementOperation } from '../operations/SmartFileEnhancement';
import { CurrentDevState } from './state';
import { WebSocketMessageResponses } from '../constants';
import { IssueReport } from '../domain/values/IssueReport';
import type { FileOutputType, FileGenerationOutputType } from '../schemas';

/**
 * SmartCodeGeneratorAgent - Enhanced version with quality-focused review cycle
 *
 * Extends SimpleCodeGeneratorAgent by adding a smart enhancement pass after
 * error-fixing review cycles. Uses CRITIC pattern (2025 best practices) to:
 * - Reduce complexity in generated code
 * - Add UX/UI polish (React 19, Tailwind v4)
 * - Simplify over-engineered patterns
 *
 * Only active when agentMode === 'smart'
 */
export class SmartCodeGeneratorAgent extends SimpleCodeGeneratorAgent {

    protected smartCodeReview: SmartCodeReviewOperation = new SmartCodeReviewOperation();
    protected smartFileEnhancement: SmartFileEnhancementOperation = new SmartFileEnhancementOperation();

    /**
     * Override review cycle to add smart enhancement pass
     * Runs AFTER standard error-fixing cycles complete
     */
    async executeReviewCycle(): Promise<CurrentDevState> {
        const result = await super.executeReviewCycle();

        if (this.state.agentMode === 'smart') {
            this.logger().info('Smart mode enabled - running enhancement cycle');
            await this.smartEnhancementCycle();
        }

        return result;
    }

    /**
     * Smart enhancement cycle - runs AFTER error-fixing review
     * Focuses on quality improvements: complexity, UX, patterns
     *
     * Flow:
     * 1. Smart review: Identify quality improvements (batched by pattern)
     * 2. Enhance files: Apply improvements in parallel
     * 3. Deploy: Deploy all enhanced files together
     */
    private async smartEnhancementCycle(): Promise<void> {
        this.logger().info('Starting smart enhancement cycle');

        this.broadcast(WebSocketMessageResponses.SMART_REVIEWING, {
            message: 'Analyzing code quality for enhancements (React 19, Tailwind v4, 2025 best practices)...',
        });

        const currentIssues = await this.fetchAllIssues();
        const issues = IssueReport.from(currentIssues);

        const reviewResult = await this.smartCodeReview.execute(
            { issues },
            this.getOperationOptions()
        );

        const systematicPatternsCount = reviewResult.systematicPatterns?.length || 0;
        const individualFilesCount = reviewResult.filesToEnhance.length;

        this.broadcast(WebSocketMessageResponses.SMART_REVIEWED, {
            message: `Smart review complete: ${systematicPatternsCount} patterns, ${individualFilesCount} unique files`,
            filesCount: reviewResult.batchSummary?.filesNeedingEnhancement || 0,
            systematicPatternsCount,
        });

        if (!reviewResult.enhancementsFound) {
            this.logger().info('No quality enhancements identified - code already high quality');
            return;
        }

        const filesToEnhance: Array<{
            file: FileOutputType;
            enhancements: string[];
            category: 'complexity_reduction' | 'ux_improvement' | 'pattern_simplification';
            effort: 'quick' | 'moderate' | 'complex';
        }> = [];

        if (reviewResult.systematicPatterns) {
            for (const pattern of reviewResult.systematicPatterns) {
                for (const filePath of pattern.affectedFiles) {
                    const file = this.fileManager.getGeneratedFile(filePath);
                    if (file) {
                        filesToEnhance.push({
                            file,
                            enhancements: [pattern.enhancement],
                            category: pattern.category,
                            effort: pattern.effort,
                        });
                    } else {
                        this.logger().warn(`Pattern file not found: ${filePath}`, { pattern: pattern.pattern });
                    }
                }
            }
        }

        for (const fileToEnhance of reviewResult.filesToEnhance) {
            if (!fileToEnhance.requireCodeChanges) continue;

            const file = this.fileManager.getGeneratedFile(fileToEnhance.filePath);
            if (!file) {
                this.logger().warn(`Individual file not found: ${fileToEnhance.filePath}`);
                continue;
            }

            filesToEnhance.push({
                file,
                enhancements: fileToEnhance.enhancements,
                category: fileToEnhance.category,
                effort: fileToEnhance.effort,
            });
        }

        if (filesToEnhance.length === 0) {
            this.logger().warn('No files to enhance (files not found)');
            return;
        }

        this.logger().info(`Enhancing ${filesToEnhance.length} files in parallel`);

        const promises: Promise<FileGenerationOutputType>[] = [];

        for (const { file, enhancements, category, effort } of filesToEnhance) {
            this.broadcast(WebSocketMessageResponses.FILE_ENHANCING, {
                message: `Enhancing ${file.filePath} (${category})...`,
                filePath: file.filePath,
                category,
                effort,
            });

            promises.push(
                this.smartFileEnhancement.execute(
                    { file, enhancements, category, effort },
                    this.getOperationOptions()
                )
            );
        }

        const fileResults = await Promise.allSettled(promises);
        const enhancedFiles: FileGenerationOutputType[] = fileResults
            .map(result => result.status === 'fulfilled' ? result.value : null)
            .filter((result): result is FileGenerationOutputType => result !== null);

        if (enhancedFiles.length === 0) {
            this.logger().error('No files were successfully enhanced');
            return;
        }

        this.logger().info(`Successfully enhanced ${enhancedFiles.length} of ${filesToEnhance.length} files`);

        for (const enhancedFile of enhancedFiles) {
            this.fileManager.saveGeneratedFile(enhancedFile);

            this.broadcast(WebSocketMessageResponses.FILE_ENHANCED, {
                message: `Enhanced ${enhancedFile.filePath}`,
                file: enhancedFile,
            });
        }

        await this.deployToSandbox(
            enhancedFiles,
            false,
            'enhance: Smart quality improvements (React 19, Tailwind v4, complexity reduction)'
        );

        this.broadcast(WebSocketMessageResponses.SMART_ENHANCED, {
            message: `Smart enhancement complete: ${enhancedFiles.length} files enhanced`,
            filesEnhanced: enhancedFiles.length,
            patternsApplied: systematicPatternsCount,
        });

        this.logger().info('Smart enhancement cycle complete', {
            filesEnhanced: enhancedFiles.length,
            systematicPatterns: systematicPatternsCount,
            individualFiles: individualFilesCount,
        });
    }
}
