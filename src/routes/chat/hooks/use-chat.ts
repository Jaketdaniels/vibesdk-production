import { WebSocket } from 'partysocket';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    RateLimitExceededError,
	type BlueprintType,
	type WebSocketMessage,
	type CodeFixEdits,
	type ImageAttachment
} from '@/api-types';
import {
	createRepairingJSONParser,
	ndjsonStream,
} from '@/utils/ndjson-parser/ndjson-parser';
import { getFileType } from '@/utils/string';
import { logger } from '@/utils/logger';
import { apiClient } from '@/lib/api-client';
import { appEvents } from '@/lib/app-events';
import { createWebSocketMessageHandler, type HandleMessageDeps } from '../utils/handle-websocket-message';
import { isConversationalMessage, addOrUpdateMessage, createUserMessage, handleRateLimitError, createAIMessage, type ChatMessage } from '../utils/message-helpers';
import { sendWebSocketMessage } from '../utils/websocket-helpers';
import { initialStages as defaultStages, updateStage as updateStageHelper } from '../utils/project-stage-helpers';
import type { ProjectStage } from '../utils/project-stage-helpers';


export interface FileType {
	filePath: string;
	fileContents: string;
	explanation?: string;
	isGenerating?: boolean;
	needsFixing?: boolean;
	hasErrors?: boolean;
	language?: string;
}

// New interface for phase timeline tracking
export interface PhaseTimelineItem {
	id: string;
	name: string;
	description: string;
	files: {
		path: string;
		purpose: string;
		status: 'generating' | 'completed' | 'error' | 'validating';
		contents?: string;
	}[];
	status: 'generating' | 'completed' | 'error' | 'validating';
	timestamp: number;
}

export function useChat({
	chatId: urlChatId,
	query: userQuery,
	images: userImages,
	agentMode = 'smart',
	onDebugMessage,
	onTerminalMessage,
}: {
	chatId?: string;
	query: string | null;
	images?: ImageAttachment[];
	agentMode?: 'deterministic' | 'smart';
	onDebugMessage?: (type: 'error' | 'warning' | 'info' | 'websocket', message: string, details?: string, source?: string, messageType?: string, rawMessage?: unknown) => void;
	onTerminalMessage?: (log: { id: string; content: string; type: 'command' | 'stdout' | 'stderr' | 'info' | 'error' | 'warn' | 'debug'; timestamp: number; source?: string }) => void;
}) {
	const connectionStatus = useRef<'idle' | 'connecting' | 'connected' | 'failed' | 'retrying'>('idle');
	const retryCount = useRef(0);
	const maxRetries = 5;
	const retryTimeouts = useRef<NodeJS.Timeout[]>([]);
	// Track whether component is mounted and should attempt reconnects
	const shouldReconnectRef = useRef(true);
	// Track the latest connection attempt to avoid handling stale socket events
	const connectAttemptIdRef = useRef(0);
	// Message throttling queue to prevent UI cycling from rapid messages
	const THROTTLE_MS = 50;
	const messageQueue = useRef<WebSocketMessage[]>([]);
	const processing = useRef(false);
	// Refs for stable callbacks - prevent handler recreation on array changes
	const filesRef = useRef<FileType[]>([]);
	const phaseTimelineRef = useRef<PhaseTimelineItem[]>([]);
	const projectStagesRef = useRef<ProjectStage[]>([]);
	const [chatId, setChatId] = useState<string>();
	const [messages, setMessages] = useState<ChatMessage[]>([
		createAIMessage('main', 'Thinking...', true),
	]);

	const [bootstrapFiles, setBootstrapFiles] = useState<FileType[]>([]);
	const [blueprint, setBlueprint] = useState<BlueprintType>();
	const [previewUrl, setPreviewUrl] = useState<string>();
	const [query, setQuery] = useState<string>();

	const [websocket, setWebsocket] = useState<WebSocket>();

	// Activity state enum to prevent impossible state combinations
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

	const [activityState, setActivityState] = useState<ActivityState>({ type: 'bootstrapping' });

	// Derived flags for backward compatibility during migration
	const isGenerating = activityState.type === 'implementing_phase' || activityState.type === 'validating_phase';
	const isThinking = activityState.type === 'thinking_next_phase';
	const isBootstrapping = activityState.type === 'bootstrapping';
	const isGeneratingBlueprint = activityState.type === 'generating_blueprint';
	const isPreviewDeploying = activityState.type === 'deploying_preview';
	const isGenerationPaused = activityState.type === 'paused';
	const isPhaseProgressActive = activityState.type === 'implementing_phase' || activityState.type === 'validating_phase' || activityState.type === 'thinking_next_phase';

	const [projectStages, setProjectStages] = useState<ProjectStage[]>(defaultStages);

	// New state for phase timeline tracking
	const [phaseTimeline, setPhaseTimeline] = useState<PhaseTimelineItem[]>([]);

	const [files, setFiles] = useState<FileType[]>([]);

	const [totalFiles, setTotalFiles] = useState<number>();

	const [edit, setEdit] = useState<Omit<CodeFixEdits, 'type'>>();

	// Deployment and generation control state
	const [isDeploying, setIsDeploying] = useState(false);
	const [cloudflareDeploymentUrl, setCloudflareDeploymentUrl] = useState<string>('');
	const [deploymentError, setDeploymentError] = useState<string>();
	const deploymentTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Redeployment state - tracks when redeploy button should be enabled
	const [isRedeployReady, setIsRedeployReady] = useState(false);
	
	// Preview refresh state - triggers preview reload after deployment
	const [shouldRefreshPreview, setShouldRefreshPreview] = useState(0);
	
	// Track whether we've completed initial state restoration to avoid disrupting active sessions
	const [isInitialStateRestored, setIsInitialStateRestored] = useState(false);

	const updateStage = useCallback(
		(stageId: ProjectStage['id'], data: Partial<Omit<ProjectStage, 'id'>>) => {
			logger.debug('updateStage', { stageId, ...data });
			setProjectStages(prev => updateStageHelper(prev, stageId, data));
		},
		[],
	);

	const onCompleteBootstrap = useCallback(() => {
		updateStage('bootstrap', { status: 'completed' });
	}, [updateStage]);

	const clearEdit = useCallback(() => {
		setEdit(undefined);
	}, []);


	const sendMessage = useCallback((message: ChatMessage) => {
		// Only add conversational messages to the chat UI
		if (!isConversationalMessage(message.conversationId)) return;
		setMessages((prev: ChatMessage[]) => addOrUpdateMessage(prev, message));
	}, []);

	const sendUserMessage = useCallback((message: string) => {
		setMessages(prev => [...prev, createUserMessage(message)]);
	}, []);

	const loadBootstrapFiles = (files: FileType[]) => {
		setBootstrapFiles((prev) => [
			...prev,
			...files.map((file) => ({
				...file,
				language: getFileType(file.filePath),
			})),
		]);
	};

	// Keep refs in sync with state for stable callback dependencies
	useEffect(() => { filesRef.current = files; }, [files]);
	useEffect(() => { phaseTimelineRef.current = phaseTimeline; }, [phaseTimeline]);
	useEffect(() => { projectStagesRef.current = projectStages; }, [projectStages]);

	// Create the WebSocket message handler
	const handleWebSocketMessage = useCallback(
		createWebSocketMessageHandler({
			// State setters
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
			// Current state
			isInitialStateRestored,
			blueprint,
			query,
			bootstrapFiles,
			getFiles: () => filesRef.current,
			getPhaseTimeline: () => phaseTimelineRef.current,
			previewUrl,
			getProjectStages: () => projectStagesRef.current,
			activityState,
			urlChatId,
			// Functions
			updateStage,
			sendMessage,
			loadBootstrapFiles,
			onDebugMessage,
			onTerminalMessage,
		} as HandleMessageDeps),
		[
			isInitialStateRestored,
			blueprint,
			query,
			bootstrapFiles,
			previewUrl,
			activityState,
			urlChatId,
			updateStage,
			sendMessage,
			loadBootstrapFiles,
			onDebugMessage,
			onTerminalMessage,
		]
	);

	// Message queue processing with throttling
	const processMessage = useCallback(async (ws: WebSocket, message: WebSocketMessage) => {
		handleWebSocketMessage(ws, message);
		await new Promise(resolve => setTimeout(resolve, THROTTLE_MS));
	}, [handleWebSocketMessage]);

	const processQueue = useCallback((ws: WebSocket) => {
		if (processing.current || messageQueue.current.length === 0) return;

		processing.current = true;
		const message = messageQueue.current.shift()!;

		processMessage(ws, message).then(() => {
			processing.current = false;
			if (messageQueue.current.length > 0) {
				processQueue(ws);
			}
		});
	}, [processMessage]);

	// WebSocket connection with retry logic
	const connectWithRetry = useCallback(
		(
			wsUrl: string,
			{ disableGenerate = false, isRetry = false }: { disableGenerate?: boolean; isRetry?: boolean } = {},
		) => {
			logger.debug(`🔌 ${isRetry ? 'Retrying' : 'Attempting'} WebSocket connection (attempt ${retryCount.current + 1}/${maxRetries + 1}):`, wsUrl);
			
			if (!wsUrl) {
				logger.error('❌ WebSocket URL is required');
				return;
			}

			connectionStatus.current = isRetry ? 'retrying' : 'connecting';

			try {
				logger.debug('🔗 Attempting WebSocket connection to:', wsUrl);
				const ws = new WebSocket(wsUrl);
				setWebsocket(ws);

				// Mark this attempt id
				const myAttemptId = ++connectAttemptIdRef.current;

				// Connection timeout - if connection doesn't open within 30 seconds
				const connectionTimeout = setTimeout(() => {
					// Only handle timeout for the latest attempt
					if (myAttemptId !== connectAttemptIdRef.current) return;
					if (ws.readyState === WebSocket.CONNECTING) {
						logger.warn('⏰ WebSocket connection timeout');
						ws.close();
						handleConnectionFailure(wsUrl, disableGenerate, 'Connection timeout');
					}
				}, 30000);

				ws.addEventListener('open', () => {
					// Ignore stale open events
					if (!shouldReconnectRef.current) {
						ws.close();
						return;
					}
					if (myAttemptId !== connectAttemptIdRef.current) return;
					
					clearTimeout(connectionTimeout);
					logger.info('✅ WebSocket connection established successfully!');
					connectionStatus.current = 'connected';
					
					// Reset retry count on successful connection
					retryCount.current = 0;
					
					// Clear any pending retry timeouts
					retryTimeouts.current.forEach(clearTimeout);
					retryTimeouts.current = [];

					// Send success message to user
					if (isRetry) {
						sendMessage(createAIMessage('websocket_reconnected', '🔌 Connection restored! Continuing with code generation...'));
					}

					// Always request conversation state explicitly (running/full history)
					sendWebSocketMessage(ws, 'get_conversation_state');

					// Request file generation for new chats only
					if (!disableGenerate && urlChatId === 'new') {
						logger.debug('🔄 Starting code generation for new chat');
						sendWebSocketMessage(ws, 'generate_all');
					}
				});

				ws.addEventListener('message', (event) => {
					try {
						const message: WebSocketMessage = JSON.parse(event.data);
						messageQueue.current.push(message);
						processQueue(ws);
					} catch (parseError) {
						logger.error('❌ Error parsing WebSocket message:', parseError, event.data);
					}
				});

				ws.addEventListener('error', (error) => {
					clearTimeout(connectionTimeout);
					// Only handle error for the latest attempt and when we should reconnect
					if (myAttemptId !== connectAttemptIdRef.current) return;
					if (!shouldReconnectRef.current) return;
					logger.error('❌ WebSocket error:', error);
					handleConnectionFailure(wsUrl, disableGenerate, 'WebSocket error');
				});

				ws.addEventListener('close', (event) => {
					clearTimeout(connectionTimeout);
					logger.info(
						`🔌 WebSocket connection closed with code ${event.code}: ${event.reason || 'No reason provided'}`,
						event,
					);
					// Only handle close for the latest attempt and when we should reconnect
					if (myAttemptId !== connectAttemptIdRef.current) return;
					if (!shouldReconnectRef.current) return;
					// Retry on any close while mounted (including 1000) to improve resilience
					handleConnectionFailure(wsUrl, disableGenerate, `Connection closed (code: ${event.code})`);
				});

				return function disconnect() {
					clearTimeout(connectionTimeout);
					ws.close();
				};
			} catch (error) {
				logger.error('❌ Error establishing WebSocket connection:', error);
				handleConnectionFailure(wsUrl, disableGenerate, 'Connection setup failed');
			}
		},
		[retryCount, maxRetries, retryTimeouts],
	);

	// Handle connection failures with exponential backoff retry
	const handleConnectionFailure = useCallback(
		(wsUrl: string, disableGenerate: boolean, reason: string) => {
			connectionStatus.current = 'failed';
			
			if (retryCount.current >= maxRetries) {
				logger.error(`💥 WebSocket connection failed permanently after ${maxRetries + 1} attempts`);
				sendMessage(createAIMessage('websocket_failed', `🚨 Connection failed permanently after ${maxRetries + 1} attempts.\n\n❌ Reason: ${reason}\n\n🔄 Please refresh the page to try again.`));
				
				// Debug logging for permanent failure
				onDebugMessage?.('error',
					'WebSocket Connection Failed Permanently',
					`Failed after ${maxRetries + 1} attempts. Reason: ${reason}`,
					'WebSocket Resilience'
				);
				return;
			}

			retryCount.current++;
			
			// Exponential backoff: 2^attempt * 1000ms (1s, 2s, 4s, 8s, 16s)
			const retryDelay = Math.pow(2, retryCount.current) * 1000;
			const maxDelay = 30000; // Cap at 30 seconds
			const actualDelay = Math.min(retryDelay, maxDelay);

			logger.warn(`🔄 Retrying WebSocket connection in ${actualDelay / 1000}s (attempt ${retryCount.current + 1}/${maxRetries + 1})`);
			
			sendMessage(createAIMessage('websocket_retrying', `🔄 Connection failed. Retrying in ${Math.ceil(actualDelay / 1000)} seconds... (attempt ${retryCount.current + 1}/${maxRetries + 1})\n\n❌ Reason: ${reason}`, true));

			const timeoutId = setTimeout(() => {
				connectWithRetry(wsUrl, { disableGenerate, isRetry: true });
			}, actualDelay);
			
			retryTimeouts.current.push(timeoutId);
			
			// Debug logging for retry attempt
			onDebugMessage?.('warning',
				'WebSocket Connection Retry',
				`Retry ${retryCount.current}/${maxRetries} in ${actualDelay / 1000}s. Reason: ${reason}`,
				'WebSocket Resilience'
			);
		},
		[maxRetries, retryCount, retryTimeouts, onDebugMessage, sendMessage],
	);

    // No legacy wrapper; call connectWithRetry directly

	useEffect(() => {
		async function init() {
			if (!urlChatId || connectionStatus.current !== 'idle') return;

			try {
				if (urlChatId === 'new') {
					if (!userQuery) {
						const errorMsg = 'Please enter a description of what you want to build';
						logger.error('Query is required for new code generation');
						toast.error(errorMsg);
						return;
					}

					// Start new code generation using API client
					const response = await apiClient.createAgentSession({
						query: userQuery,
						agentMode,
						images: userImages, // Pass images from URL params for multi-modal blueprint
					});

					const parser = createRepairingJSONParser();

					const result: {
						websocketUrl: string;
						agentId: string;
						template: {
							files: FileType[];
						};
					} = {
						websocketUrl: '',
						agentId: '',
						template: {
							files: [],
						},
					};

					let startedBlueprintStream = false;
					sendMessage(createAIMessage('main', "Sure, let's get started. Bootstrapping the project first...", true));

					for await (const obj of ndjsonStream(response.stream)) {
                        logger.debug('Received chunk from server:', obj);
						if (obj.chunk) {
							if (!startedBlueprintStream) {
								sendMessage(createAIMessage('main', 'Blueprint is being generated...', true));
								logger.info('Blueprint stream has started');
								setActivityState({ type: 'generating_blueprint' });
								startedBlueprintStream = true;
								updateStage('bootstrap', { status: 'completed' });
								updateStage('blueprint', { status: 'active' });
							}
							parser.feed(obj.chunk);
							try {
								const partial = parser.finalize();
								setBlueprint(partial);
							} catch (e) {
								logger.error('Error parsing JSON:', e, obj.chunk);
							}
						} 
						if (obj.agentId) {
							result.agentId = obj.agentId;
						}
						if (obj.websocketUrl) {
							result.websocketUrl = obj.websocketUrl;
							logger.debug('📡 Received WebSocket URL from server:', result.websocketUrl)
						}
						if (obj.template) {
                            logger.debug('Received template from server:', obj.template);
							result.template = obj.template;
							if (obj.template.files) {
								loadBootstrapFiles(obj.template.files);
							}
						}
					}

					updateStage('blueprint', { status: 'completed' });
					setActivityState({ type: 'idle' });
					sendMessage(createAIMessage('main', 'Blueprint generation complete. Now starting the code generation...', true));

					// Connect to WebSocket
					logger.debug('connecting to ws with created id');
					connectWithRetry(result.websocketUrl);
					setChatId(result.agentId); // This comes from the server response
					
					// Emit app-created event for sidebar updates
					appEvents.emitAppCreated(result.agentId, {
						title: userQuery || 'New App',
						description: userQuery,
					});
				} else if (connectionStatus.current === 'idle') {
					setActivityState({ type: 'idle' });
					// Get existing progress
					sendMessage(createAIMessage('fetching-chat', 'Fetching your previous chat...'));

					// Fetch existing agent connection details
					const response = await apiClient.connectToAgent(urlChatId);
					if (!response.success || !response.data) {
						logger.error('Failed to fetch existing chat:', { chatId: urlChatId, error: response.error });
						throw new Error(response.error?.message || 'Failed to connect to agent');
					}

					logger.debug('Existing agentId API result', response.data);
					// Set the chatId for existing chat - this enables the chat input
					setChatId(urlChatId);

					sendMessage(createAIMessage('resuming-chat', 'Starting from where you left off...'));

					logger.debug('connecting from init for existing chatId');
					connectWithRetry(response.data.websocketUrl, {
						disableGenerate: true, // We'll handle generation resume in the WebSocket open handler
					});
				}
			} catch (error) {
				logger.error('Error initializing code generation:', error);
				if (error instanceof RateLimitExceededError) {
					const rateLimitMessage = handleRateLimitError(error.details, onDebugMessage);
					setMessages(prev => [...prev, rateLimitMessage]);
				}
			}
		}
		init();
	}, []);

    // Mount/unmount: enable/disable reconnection and clear pending retries
    useEffect(() => {
        shouldReconnectRef.current = true;
        return () => {
            shouldReconnectRef.current = false;
            retryTimeouts.current.forEach(clearTimeout);
            retryTimeouts.current = [];
        };
    }, []);

    // Close previous websocket on change
    useEffect(() => {
        return () => {
            websocket?.close();
        };
    }, [websocket]);

	useEffect(() => {
		if (edit) {
			// When edit is cleared, write the edit changes
			return () => {
				setFiles((prev) =>
					prev.map((file) => {
						if (file.filePath === edit.filePath) {
							file.fileContents = file.fileContents.replace(
								edit.search,
								edit.replacement,
							);
						}
						return file;
					}),
				);
			};
		}
	}, [edit]);

	// Clear deployment timeout when deployment completes (success or error)
	useEffect(() => {
		if (!isDeploying && deploymentTimeoutRef.current) {
			clearTimeout(deploymentTimeoutRef.current);
			deploymentTimeoutRef.current = null;
		}
	}, [isDeploying]);

	// Cleanup deployment timeout on unmount
	useEffect(() => {
		return () => {
			if (deploymentTimeoutRef.current) {
				clearTimeout(deploymentTimeoutRef.current);
			}
		};
	}, []);

	// Control functions for deployment and generation
	const handleStopGeneration = useCallback(() => {
		sendWebSocketMessage(websocket, 'stop_generation');
	}, [websocket]);

	const handleResumeGeneration = useCallback(() => {
		sendWebSocketMessage(websocket, 'resume_generation');
	}, [websocket]);

	const handleDeployToCloudflare = useCallback(async (instanceId: string) => {
		try {
			// Send deployment command via WebSocket instead of HTTP request
			if (sendWebSocketMessage(websocket, 'deploy', { instanceId })) {
				logger.debug('🚀 Deployment WebSocket message sent:', instanceId);

				// Clear any existing timeout before setting new one
				if (deploymentTimeoutRef.current) {
					clearTimeout(deploymentTimeoutRef.current);
					deploymentTimeoutRef.current = null;
				}

				// Set 1-minute timeout for deployment
				deploymentTimeoutRef.current = setTimeout(() => {
					if (isDeploying) {
						logger.warn('⏰ Deployment timeout after 1 minute');

						// Reset deployment state
						setIsDeploying(false);
						setCloudflareDeploymentUrl('');
						setIsRedeployReady(false);

						// Show timeout message
						sendMessage(createAIMessage('deployment_timeout', `⏰ Deployment timed out after 1 minute.\n\n🔄 Please try deploying again. The server may be busy.`));

						// Debug logging for timeout
						onDebugMessage?.('warning',
							'Deployment Timeout',
							`Deployment for ${instanceId} timed out after 60 seconds`,
							'Deployment Timeout Management'
						);
					}

					// Clear the ref after timeout fires
					deploymentTimeoutRef.current = null;
				}, 60000); // 1 minute = 60,000ms

			} else {
				throw new Error('WebSocket connection not available');
			}
		} catch (error) {
			logger.error('❌ Error sending deployment WebSocket message:', error);

			// Set deployment state immediately for UI feedback
			setIsDeploying(true);
			// Clear any previous deployment error
			setDeploymentError('');
			setCloudflareDeploymentUrl('');
			setIsRedeployReady(false);

			sendMessage(createAIMessage('deployment_error', `❌ Failed to initiate deployment: ${error instanceof Error ? error.message : 'Unknown error'}\n\n🔄 You can try again.`));
		}
	}, [websocket, sendMessage, isDeploying, onDebugMessage]);

	return {
		messages,
		edit,
		bootstrapFiles,
		chatId,
		query,
		files,
		blueprint,
		previewUrl,
		isGeneratingBlueprint,
		isBootstrapping,
		totalFiles,
		websocket,
		sendUserMessage,
		sendAiMessage: sendMessage,
		clearEdit,
		projectStages,
		phaseTimeline,
		isThinking,
		onCompleteBootstrap,
		// Deployment and generation control
		isDeploying,
		cloudflareDeploymentUrl,
		deploymentError,
		isRedeployReady,
		isGenerationPaused,
		isGenerating,
		handleStopGeneration,
		handleResumeGeneration,
		handleDeployToCloudflare,
		// Preview refresh control
		shouldRefreshPreview,
		// Preview deployment state
		isPreviewDeploying,
		// Phase progress visual indicator
		isPhaseProgressActive,
	};
}
