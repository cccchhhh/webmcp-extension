import { z } from 'zod';
export const ChatTargetSchema = z
  .object({ pageId: z.string().uuid(), documentId: z.string(), catalogVersion: z.string().uuid() })
  .strict();
export type ChatTarget = z.infer<typeof ChatTargetSchema>;
const session = { sessionId: z.string().uuid() };
const invocation = { ...session, invocationId: z.string().uuid() };
export const ChatContextSchema = z
  .object({
    ...invocation,
    runId: z.string().uuid(),
    providerToolCallId: z.string().min(1).max(1024),
    grantId: z.string().uuid(),
  })
  .strict();
export type ChatCallContext = z.infer<typeof ChatContextSchema>;
export const ChatCommandSchemas = [
  z.object({ type: z.literal('CHECK_CHAT_GRANT'), grantId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('CREATE_CHAT_GRANT'),
      ...session,
      target: ChatTargetSchema.optional(),
      toolNames: z.array(z.string()).max(30),
      profileId: z.string().uuid(),
      profileVersion: z.number().int(),
      mode: z.enum(['confirm', 'auto']),
      takeover: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('REVOKE_CHAT_GRANT'), grantId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('APPROVE_CHAT_CALL'),
      context: ChatContextSchema,
      toolName: z.string(),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('CHAT_INVOKE'),
      context: ChatContextSchema,
      target: ChatTargetSchema,
      toolName: z.string(),
      arguments: z.record(z.string(), z.unknown()),
      approvalToken: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ type: z.literal('GET_CHAT_INVOCATION'), ...invocation }).strict(),
  z.object({ type: z.literal('CANCEL_CHAT_RUN'), ...session, runId: z.string().uuid() }).strict(),
  z
    .object({ type: z.literal('READ_CHAT_RESULT'), ...invocation, grantId: z.string().uuid() })
    .strict(),
] as const;
export const ChatCommandSchema = z.discriminatedUnion('type', ChatCommandSchemas);
export type ChatCommand = z.infer<typeof ChatCommandSchema>;
export interface ChatInvocation {
  context: ChatCallContext;
  target: ChatTarget;
  toolName: string;
  digest: string;
  callId: string;
  consumed?: boolean;
}
export interface ModelProfile {
  id: string;
  version: number;
  name: string;
  protocol: 'openai-chat-completions';
  baseUrl: string;
  model: string;
  credentialId: string;
  keyStorage: 'session' | 'local';
  redactFields: string[];
}
export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}
export interface ChatTrace {
  afterMessageId?: string;
  invocationId: string;
  name: string;
  arguments: Record<string, unknown>;
  status: string;
  callId?: string;
  result?: unknown;
}
export interface ChatSession {
  schemaVersion: 1;
  authorization?: {
    toolNames: string[];
    mode: 'auto' | 'confirm';
    revoked: boolean;
    customized: boolean;
  };
  id: string;
  profileId: string;
  profileVersion: number;
  target?: ChatTarget;
  origin?: string;
  toolAliases?: [string, string][];
  messages: ChatMessage[];
  turns: ProviderMessage[][];
  pendingTurn?: ProviderMessage[];
  traces: ChatTrace[];
  status: string;
}
