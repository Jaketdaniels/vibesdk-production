import type { WebSocket } from 'partysocket';
import type { WebSocketMessage, BlueprintType, ConversationMessage } from '@/api-types';
import { logger } from '@/utils/logger';
import { getFileType } from '@/utils/string';
import { getPreviewUrl } from '@/lib/utils';
import {
    setFileGenerating,
    appendFileChunk,
    setFileCompleted,
    setAllFilesCompleted,
    updatePhaseFileStatus,
} from './file-state-helpers';
import { 
    createAIMessage,
    handleRateLimitError,
    handleStreamingMessage,
    appendToolEvent,
    type ChatMessage,
} from './message-helpers';
import { completeStages } from './project-stage-helpers';
import { sendWebSocketMessage } from './websocket-helpers';
import type { FileType, PhaseTimelineItem } from '../hooks/use-chat';
import { toast } from 'sonner';

// Activity state type definition
type ActivityState =
    | { type: 'idle' }
    | { type: 'bootstrapping' }
    | { type: 'generating_blueprint' }
    | { type: 'thinking_next_phase' }
    | { type: 'implementing_phase'; phaseName: string }
    | { type: 'validating_phase'; phaseName: string }
    | { type: 'deploying_preview' }
    | { type: 'paused'; pausedFrom: ActivityState }
    | { type: 'completed' };

export interface HandleMessageDeps {
    // State setters
    setFiles: React.Dispatch<React.SetStateAction<FileType[]>>;
    setPhaseTimeline: React.Dispatch<React.SetStateAction<PhaseTimelineItem[]>>;
    setProjectStages: React.Dispatch<React.SetStateAction<any[]>>;
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    setBlueprint: React.Dispatch<React.SetStateAction<BlueprintType | undefined>>;
    setQuery: React.Dispatch<React.SetStateAction<string | undefined>>;
    setPreviewUrl: React.Dispatch<React.SetStateAction<string | undefined>>;
    setTotalFiles: React.Dispatch<React.SetStateAction<number | undefined>>;
    setIsRedeployReady: React.Dispatch<React.SetStateAction<boolean>>;
    setActivityState: React.Dispatch<React.SetStateAction<ActivityState>>;
    setIsInitialStateRestored: React.Dispatch<React.SetStateAction<boolean>>;
    setShouldRefreshPreview: React.Dispatch<React.SetStateAction<number>>;
    setIsDeploying: React.Dispatch<React.SetStateAction<boolean>>;
    setCloudflareDeploymentUrl: React.Dispatch<React.SetStateAction<string>>;
    setDeploymentError: React.Dispatch<React.SetStateAction<string | undefined>>;

    // Current state
    isInitialStateRestored: boolean;
    blueprint: BlueprintType | undefined;
    query: string | undefined;
    bootstrapFiles: FileType[];
    getFiles: () => FileType[];
    getPhaseTimeline: () => PhaseTimelineItem[];
    previewUrl: string | undefined;
    getProjectStages: () => any[];
    activityState: ActivityState;
    urlChatId: string | undefined;
    
    // Functions
    updateStage: (stageId: string, updates: any) => void;
    sendMessage: (message: ConversationMessage) => void;
    loadBootstrapFiles: (files: FileType[]) => void;
    onDebugMessage?: (
        type: 'error' | 'warning' | 'info' | 'websocket',
        message: string,
        details?: string,
        source?: string,
        messageType?: string,
        rawMessage?: unknown
    ) => void;
    onTerminalMessage?: (log: { 
        id: string; 
        content: string; 
        type: 'command' | 'stdout' | 'stderr' | 'info' | 'error' | 'warn' | 'debug'; 
        timestamp: number; 
        source?: string 
    }) => void;
}

export function createWebSocketMessageHandler(deps: HandleMessageDeps) {
    const extractTextContent = (content: ConversationMessage['content']): string => {
        if (!content) return '';
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .map(c => (c && 'type' in c && c.type === 'text') ? c.text : '')
                .join(' ')
                .trim();
        }
        return '';
    };
    return (websocket: WebSocket, message: WebSocketMessage) => {
        const {
            setFiles,
            setPhaseTimeline,
            setProjectStages,
            setMessages,
            setBlueprint,
            setQuery,
            setPreviewUrl,
            setTotalFiles,
            setIsRedeployReady,
            setActivityState,
            setIsInitialStateRestored,
            setShouldRefreshPreview,
            setIsDeploying,
            setCloudflareDeploymentUrl,
            setDeploymentError,
            isInitialStateRestored,
            blueprint,
            query,
            bootstrapFiles,
            getFiles,
            getPhaseTimeline,
            previewUrl,
            getProjectStages,
            activityState,
            urlChatId,
            updateStage,
            sendMessage,
            loadBootstrapFiles,
            onDebugMessage,
            onTerminalMessage,
        } = deps;

        // Derived activity flags from activityState
        const isGenerating = activityState.type === 'implementing_phase' || activityState.type === 'validating_phase';

        // Phase gate validation helper
        const validatePhaseMessage = (
            messageType: string,
            currentState: {
                blueprint?: BlueprintType;
                files: FileType[];
                projectStages: any[];
            }
        ): { valid: boolean; reason?: string } => {
            switch (messageType) {
                case 'generation_started':
                    if (!currentState.blueprint) {
                        return { valid: false, reason: 'No blueprint exists' };
                    }
                    break;

                case 'phase_validating':
                    if (currentState.files.length === 0) {
                        return { valid: false, reason: 'No files to validate' };
                    }
                    break;

                case 'phase_implemented':
                    const generating = currentState.files.filter(f => f.isGenerating);
                    if (generating.length > 0) {
                        return { valid: false, reason: `${generating.length} files still generating` };
                    }
                    break;
            }

            return { valid: true };
        };

        // Validate phase messages before processing
        const PHASE_MESSAGES = ['generation_started', 'phase_validating', 'phase_validated', 'phase_implemented'];

        if (PHASE_MESSAGES.includes(message.type)) {
            const validation = validatePhaseMessage(message.type, {
                blueprint: blueprint,
                files: getFiles(),
                projectStages: getProjectStages()
            });

            if (!validation.valid) {
                logger.warn(`Rejected premature message: ${message.type} - ${validation.reason}`);
                return;
            }
        }

        // Log messages except for frequent ones
        if (message.type !== 'file_chunk_generated' && message.type !== 'cf_agent_state' && message.type.length <= 50) {
            logger.info('received message', message.type, message);
            onDebugMessage?.('websocket', 
                `${message.type}`,
                JSON.stringify(message, null, 2),
                'WebSocket',
                message.type,
                message
            );
        }
        
        switch (message.type) {
            case 'cf_agent_state': {
                const { state } = message;
                logger.debug('🔄 Agent state update received:', state);

                if (!isInitialStateRestored) {
                    logger.debug('📥 Performing initial state restoration');

                    // Get current state using getters (Task 4: Stable Callback Dependencies)
                    const currentFiles = getFiles();
                    const currentTimeline = getPhaseTimeline();
                    void getProjectStages(); // Call getter to ensure stable callback pattern

                    if (state.blueprint && !blueprint) {
                        setBlueprint(state.blueprint);
                        updateStage('blueprint', { status: 'completed' });
                    }

                    if (state.query && !query) {
                        setQuery(state.query);
                    }

                    if (state.templateDetails?.files && bootstrapFiles.length === 0) {
                        loadBootstrapFiles(state.templateDetails.files);
                    }

                    if (state.generatedFilesMap && currentFiles.length === 0) {
                        setFiles(
                            Object.values(state.generatedFilesMap).map((file: any) => ({
                                filePath: file.filePath,
                                fileContents: file.fileContents,
                                isGenerating: false,
                                needsFixing: false,
                                hasErrors: false,
                                language: getFileType(file.filePath),
                            })),
                        );
                    }

                    if (state.generatedPhases && state.generatedPhases.length > 0 && currentTimeline.length === 0) {
                        logger.debug('📋 Restoring phase timeline:', state.generatedPhases);
                        const timeline = state.generatedPhases.map((phase: any, index: number) => ({
                            id: `phase-${index}`,
                            name: phase.name,
                            description: phase.description,
                            status: phase.completed ? 'completed' as const : 'generating' as const,
                            files: phase.files.map((filesConcept: any) => {
                                const file = state.generatedFilesMap?.[filesConcept.path];
                                return {
                                    path: filesConcept.path,
                                    purpose: filesConcept.purpose,
                                    status: (file ? 'completed' as const : 'generating' as const),
                                    contents: file?.fileContents
                                };
                            }),
                            timestamp: Date.now(),
                        }));
                        setPhaseTimeline(timeline);
                    }
                    
                    updateStage('bootstrap', { status: 'completed' });
                    
                    if (state.blueprint) {
                        updateStage('blueprint', { status: 'completed' });
                    }
                    
                    if (state.generatedFilesMap && Object.keys(state.generatedFilesMap).length > 0) {
                        updateStage('code', { status: 'completed' });
                        updateStage('validate', { status: 'completed' });
                    }

                    setIsInitialStateRestored(true);

                    if (state.generatedFilesMap && Object.keys(state.generatedFilesMap).length > 0 && 
                        urlChatId !== 'new') {
                        logger.debug('🚀 Requesting preview deployment for existing chat with files');
                        sendWebSocketMessage(websocket, 'preview');
                    }
                }

                if (state.shouldBeGenerating) {
                    logger.debug('🔄 shouldBeGenerating=true detected, auto-resuming generation');
                    updateStage('code', { status: 'active' });
                    
                    logger.debug('📡 Sending auto-resume generate_all message');
                    sendWebSocketMessage(websocket, 'generate_all');
                } else {
                    const codeStage = getProjectStages().find((stage: any) => stage.id === 'code');
                    if (codeStage?.status === 'active' && !isGenerating) {
                        if (state.generatedFilesMap && Object.keys(state.generatedFilesMap).length > 0) {
                            updateStage('code', { status: 'completed' });
                            updateStage('validate', { status: 'completed' });

                            if (!previewUrl) {
                                logger.debug('🚀 Generated files exist but no preview URL - auto-deploying preview');
                                sendWebSocketMessage(websocket, 'preview');
                            }
                        }
                    }
                }

                logger.debug('✅ Agent state update processed');
                break;
            }

            case 'conversation_state': {
                const { state } = message;
                const history: ReadonlyArray<ConversationMessage> = state?.runningHistory ?? [];
                logger.debug('Received conversation_state with messages:', history.length);

                const restoredMessages: ChatMessage[] = history.reduce<ChatMessage[]>((acc, msg) => {
                    if (msg.role !== 'user' && msg.role !== 'assistant') return acc;
                    const text = extractTextContent(msg.content);
                    if (!text || text.includes('<Internal Memo>')) return acc;

                    const convId = msg.conversationId;
                    const isArchive = msg.role === 'assistant' && convId.startsWith('archive-');

                    acc.push({
                        role: msg.role,
                        conversationId: convId,
                        content: isArchive ? 'previous history was compacted' : text,
                    });
                    return acc;
                }, []);

                if (restoredMessages.length > 0) {
                    logger.debug('Replacing messages with conversation_state history:', restoredMessages.length);
                    setMessages(restoredMessages);
                }
                break;
            }

            case 'file_generating': {
                setFiles((prev) => setFileGenerating(prev, message.filePath));
                break;
            }

            case 'file_chunk_generated': {
                setFiles((prev) => appendFileChunk(prev, message.filePath, message.chunk));
                break;
            }

            case 'file_generated': {
                setFiles((prev) => setFileCompleted(prev, message.file.filePath, message.file.fileContents));
                setPhaseTimeline((prev) => updatePhaseFileStatus(
                    prev,
                    message.file.filePath,
                    'completed',
                    message.file.fileContents
                ));
                break;
            }

            case 'file_regenerated': {
                setIsRedeployReady(true);
                setFiles((prev) => setFileCompleted(prev, message.file.filePath, message.file.fileContents));
                setPhaseTimeline((prev) => updatePhaseFileStatus(
                    prev,
                    message.file.filePath,
                    'completed',
                    message.file.fileContents
                ));
                break;
            }

            case 'file_regenerating': {
                setFiles((prev) => setFileGenerating(prev, message.filePath, 'File being regenerated...'));
                setPhaseTimeline((prev) => updatePhaseFileStatus(prev, message.filePath, 'generating'));
                break;
            }

            case 'generation_started': {
                updateStage('code', { status: 'active' });
                setTotalFiles(message.totalFiles);
                setActivityState({ type: 'idle' });
                break;
            }

            case 'generation_complete': {
                setIsRedeployReady(true);
                setFiles((prev) => setAllFilesCompleted(prev));
                setProjectStages((prev) => completeStages(prev, ['code', 'validate', 'fix']));

                sendMessage(createAIMessage('generation-complete', 'Code generation has been completed.'));
                setActivityState({ type: 'completed' });
                break;
            }

            case 'deployment_started': {
                setActivityState({ type: 'deploying_preview' });
                break;
            }

            case 'deployment_completed': {
                setActivityState({ type: 'completed' });
                const finalPreviewURL = getPreviewUrl(message.previewURL, message.tunnelURL);
                setPreviewUrl(finalPreviewURL);
                break;
            }

            case 'deployment_failed': {
                toast.error(`Error: ${message.message}`);
                setActivityState({ type: 'idle' });
                break;
            }

            case 'code_reviewed': {
                const reviewData = message.review;
                const totalIssues = reviewData?.filesToFix?.reduce((count: number, file: any) => 
                    count + file.issues.length, 0) || 0;
                
                let reviewMessage = 'Code review complete';
                if (reviewData?.issuesFound) {
                    reviewMessage = `Code review complete - ${totalIssues} issue${totalIssues !== 1 ? 's' : ''} found across ${reviewData.filesToFix?.length || 0} file${reviewData.filesToFix?.length !== 1 ? 's' : ''}`;
                } else {
                    reviewMessage = 'Code review complete - no issues found';
                }
                
                sendMessage(createAIMessage('code_reviewed', reviewMessage));
                break;
            }

            case 'runtime_error_found': {
                logger.info('Runtime error found in sandbox', message.errors);
                
                onDebugMessage?.('error', 
                    `Runtime Error (${message.count} errors)`,
                    message.errors.map((e: any) => `${e.message}\nStack: ${e.stack || 'N/A'}`).join('\n\n'),
                    'Runtime Detection'
                );
                break;
            }

            case 'code_reviewing': {
                const totalIssues =
                    (message.staticAnalysis?.lint?.issues?.length || 0) +
                    (message.staticAnalysis?.typecheck?.issues?.length || 0) +
                    (message.runtimeErrors.length || 0);

                updateStage('validate', { status: 'active' });

                if (totalIssues > 0) {
                    updateStage('fix', { status: 'active', metadata: `Fixing ${totalIssues} issues` });
                    
                    const errorDetails = [
                        `Lint Issues: ${JSON.stringify(message.staticAnalysis?.lint?.issues)}`,
                        `Type Errors: ${JSON.stringify(message.staticAnalysis?.typecheck?.issues)}`,
                        `Runtime Errors: ${JSON.stringify(message.runtimeErrors)}`,
                        `Client Errors: ${JSON.stringify(message.clientErrors)}`,
                    ].filter(Boolean).join('\n');
                    
                    onDebugMessage?.('warning', 
                        `Generation Issues Found (${totalIssues} total)`,
                        errorDetails,
                        'Code Generation'
                    );
                }
                break;
            }

            case 'phase_generating': {
                updateStage('validate', { status: 'completed' });
                updateStage('fix', { status: 'completed' });
                sendMessage(createAIMessage('phase_generating', message.message));
                setActivityState({ type: 'thinking_next_phase' });
                break;
            }

            case 'phase_generated': {
                sendMessage(createAIMessage('phase_generated', message.message));
                setActivityState({ type: 'idle' });
                break;
            }

            case 'phase_implementing': {
                sendMessage(createAIMessage('phase_implementing', message.message));
                updateStage('code', { status: 'active' });

                if (message.phase) {
                    setActivityState({ type: 'implementing_phase', phaseName: message.phase.name });
                    setPhaseTimeline(prev => {
                        const existingPhase = prev.find(p => p.name === message.phase.name);
                        if (existingPhase) {
                            logger.debug('Phase already exists in timeline:', message.phase.name);
                            return prev;
                        }

                        const newPhase = {
                            id: `${message.phase.name}-${Date.now()}`,
                            name: message.phase.name,
                            description: message.phase.description,
                            files: message.phase.files?.map((f: any) => ({
                                path: f.path,
                                purpose: f.purpose,
                                status: 'generating' as const,
                            })) || [],
                            status: 'generating' as const,
                            timestamp: Date.now()
                        };

                        logger.debug('Added new phase to timeline:', message.phase.name);
                        return [...prev, newPhase];
                    });
                }
                break;
            }

            case 'phase_validating': {
                sendMessage(createAIMessage('phase_validating', message.message));
                updateStage('validate', { status: 'active' });

                const timeline = getPhaseTimeline();
                if (timeline.length > 0) {
                    const lastPhase = timeline[timeline.length - 1];
                    logger.debug(`Phase validating: ${lastPhase.name}`);
                    setActivityState({ type: 'validating_phase', phaseName: lastPhase.name });
                }

                setPhaseTimeline(prev => {
                    const updated = [...prev];
                    if (updated.length > 0) {
                        const lastPhase = updated[updated.length - 1];
                        lastPhase.status = 'validating';
                    }
                    return updated;
                });
                break;
            }

            case 'phase_validated': {
                sendMessage(createAIMessage('phase_validated', message.message));
                updateStage('validate', { status: 'completed' });
                setActivityState({ type: 'idle' });
                break;
            }

            case 'phase_implemented': {
                sendMessage(createAIMessage('phase_implemented', message.message));

                updateStage('code', { status: 'completed' });
                setIsRedeployReady(true);
                setActivityState({ type: 'idle' });
                
                if (message.phase) {
                    setPhaseTimeline(prev => {
                        const updated = [...prev];
                        if (updated.length > 0) {
                            const lastPhase = updated[updated.length - 1];
                            lastPhase.status = 'completed';
                            lastPhase.files = lastPhase.files.map(f => ({ ...f, status: 'completed' as const }));
                            logger.debug(`Phase completed: ${lastPhase.name}`);
                        }
                        return updated;
                    });
                }

                logger.debug('🔄 Scheduling preview refresh in 1 second after deployment completion');
                setTimeout(() => {
                    logger.debug('🔄 Triggering preview refresh after deployment completion');
                    setShouldRefreshPreview(prev => prev + 1);

                    onDebugMessage?.('info',
                        'Preview Auto-Refresh Triggered',
                        `Preview refreshed 1 second after deployment completion`,
                        'Preview Auto-Refresh'
                    );
                }, 1000);
                break;
            }

            case 'generation_stopped': {
                setActivityState(prev => ({ type: 'paused', pausedFrom: prev }));
                sendMessage(createAIMessage('generation_stopped', message.message));
                break;
            }

            case 'generation_resumed': {
                setActivityState(prev =>
                    prev.type === 'paused' ? prev.pausedFrom : { type: 'implementing_phase', phaseName: 'resumed' }
                );
                sendMessage(createAIMessage('generation_resumed', message.message));
                break;
            }

            case 'cloudflare_deployment_started': {
                setIsDeploying(true);
                sendMessage(createAIMessage('cloudflare_deployment_started', message.message));
                break;
            }

            case 'cloudflare_deployment_completed': {
                setIsDeploying(false);
                setCloudflareDeploymentUrl(message.deploymentUrl);
                setDeploymentError('');
                setIsRedeployReady(false);
                
                sendMessage(createAIMessage('cloudflare_deployment_completed', `Your project has been permanently deployed to Cloudflare Workers: ${message.deploymentUrl}`));
                
                onDebugMessage?.('info',
                    'Deployment Completed - Redeploy Reset',
                    `Deployment URL: ${message.deploymentUrl}\nPhase count at deployment: ${getPhaseTimeline().length}\nRedeploy button disabled until next phase`,
                    'Redeployment Management'
                );
                break;
            }

            case 'cloudflare_deployment_error': {
                setIsDeploying(false);
                setDeploymentError(message.error || 'Unknown deployment error');
                setCloudflareDeploymentUrl('');
                setIsRedeployReady(true);
                
                sendMessage(createAIMessage('cloudflare_deployment_error', `❌ Deployment failed: ${message.error}\n\n🔄 You can try deploying again.`));

                toast.error(`Error: ${message.error}`);
                
                onDebugMessage?.('error', 
                    'Deployment Failed - State Reset',
                    `Error: ${message.error}\nDeployment button reset for retry`,
                    'Deployment Error Recovery'
                );
                break;
            }

            case 'github_export_started': {
                sendMessage(createAIMessage('github_export_started', message.message));
                break;
            }

            case 'github_export_progress': {
                sendMessage(createAIMessage('github_export_progress', message.message));
                break;
            }

            case 'github_export_completed': {
                sendMessage(createAIMessage('github_export_completed', message.message));
                break;
            }

            case 'github_export_error': {
                sendMessage(createAIMessage('github_export_error', `❌ GitHub export failed: ${message.error}`));

                toast.error(`Error: ${message.error}`);
                
                break;
            }

            case 'conversation_response': {
                // Use concrete conversationId when available; otherwise use placeholder id
                let conversationId = message.conversationId ?? 'conversation_response';

                // If a concrete id arrives later, update placeholder once
                if (message.conversationId) {
                    const convId = message.conversationId;
                    setMessages(prev => {
                        const genericIdx = prev.findIndex(m => m.role === 'assistant' && m.conversationId === 'conversation_response');
                        if (genericIdx !== -1) {
                            return prev.map((m, i) => i === genericIdx ? { ...m, conversationId: convId } : m);
                        }
                        return prev;
                    });
                    conversationId = convId;
                }

                const isArchive = conversationId.startsWith('archive-');
                const placeholder = 'previous history was compacted';

                if (message.tool) {
                    const tool = message.tool;
                    setMessages(prev => appendToolEvent(prev, conversationId, { name: tool.name, status: tool.status }));
                    break;
                }

                if (message.isStreaming) {
                    setMessages(prev => handleStreamingMessage(prev, conversationId, isArchive ? placeholder : message.message, false));
                    break;
                }

                setMessages(prev => {
                    const idx = prev.findIndex(m => m.role === 'assistant' && m.conversationId === conversationId);
                    if (idx !== -1) return prev.map((m, i) => i === idx ? { ...m, content: (isArchive ? placeholder : message.message) } : m);
                    return [...prev, createAIMessage(conversationId, isArchive ? placeholder : message.message)];
                });
                break;
            }

            case 'terminal_output': {
                // Handle terminal output from server
                if (onTerminalMessage) {
                    const terminalLog = {
                        id: `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                        content: message.output,
                        type: message.outputType as 'stdout' | 'stderr' | 'info',
                        timestamp: message.timestamp
                    };
                    onTerminalMessage(terminalLog);
                }
                break;
            }

            case 'server_log': {
                // Handle server logs
                if (onTerminalMessage) {
                    const serverLog = {
                        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                        content: message.message,
                        type: message.level as 'info' | 'warn' | 'error' | 'debug',
                        timestamp: message.timestamp,
                        source: message.source
                    };
                    onTerminalMessage(serverLog);
                }
                break;
            }

            case 'error': {
                const errorData = message;
                setMessages(prev => [
                    ...prev,
                    createAIMessage(`error_${Date.now()}`, `❌ ${errorData.error}`)
                ]);
                
                onDebugMessage?.(
                    'error',
                    'WebSocket Error',
                    errorData.error,
                    'WebSocket',
                    'error',
                    errorData
                );
                break;
            }

            case 'rate_limit_error': {
                const errorData = message.error;
                const rateLimitMessage = handleRateLimitError(
                    errorData.details,
                    onDebugMessage
                );
                setMessages(prev => [...prev, rateLimitMessage]);
                
                break;
            }

            default:
                logger.warn('Unhandled message:', message);
        }
    };
}
