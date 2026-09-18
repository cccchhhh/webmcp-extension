import { ChatCommandSchemas, type ChatCallContext, type ChatInvocation } from './chat';
import {
  RemoteSettingsSchema,
  emptyRemote,
  type RemoteState,
  type Sharing,
  type AgentCall,
} from './remote';
import { z } from 'zod';
export type Schema = boolean | Record<string, unknown>;
export type Discovery =
  | 'unsupported'
  | 'permission_required'
  | 'restricted_page'
  | 'ready_empty'
  | 'ready'
  | 'discovery_failed';
export interface PageTool {
  name: string;
  description: string;
  inputSchema: Schema;
  executable: boolean;
  unavailableReason?: string;
}
export interface Page {
  pageId: string;
  tabId: number;
  documentId: string;
  title: string;
  url: string;
  catalogVersion: string;
  tools: PageTool[];
  discovery: Discovery;
  error?: string;
}
export interface CallRecord {
  callId: string;
  pageId: string;
  catalogVersion: string;
  toolName: string;
  source: 'manual' | 'agent' | 'aiChat';
  chat?: ChatCallContext;
  agent?: Omit<AgentCall, 'arguments'>;
  remoteResultRevoked?: boolean;
  delivery: 'not_sent' | 'sent' | 'acknowledged';
  execution: 'running' | 'returned' | 'rejected' | 'unknown';
  business: 'unclassified' | 'error';
  startedAt: string;
  deadline: number;
  durationMs?: number;
  errorCode?: string;
  arguments?: Record<string, unknown>;
  rawResult?: unknown;
  released?: boolean;
  late?: boolean;
}
export interface Snapshot {
  chatInvocations?: Record<string, ChatInvocation>;
  pages: Record<string, Page>;
  calls: CallRecord[];
  locks: Record<string, string>;
  deviceName: string;
  remote: RemoteState;
  sharing: Record<string, Sharing>;
}
export const emptySnapshot = (): Snapshot => ({
  pages: {},
  calls: [],
  locks: {},
  deviceName: '我的浏览器',
  remote: emptyRemote(),
  sharing: {},
});
const target = {
  pageId: z.string().uuid(),
  catalogVersion: z.string().uuid(),
  toolName: z.string().min(1).max(1024),
};
export const CommandSchema = z.discriminatedUnion('type', [
  ...ChatCommandSchemas,
  z.object({ type: z.literal('GET_SNAPSHOT') }).strict(),
  z.object({ type: z.literal('SAVE_REMOTE'), settings: RemoteSettingsSchema }).strict(),
  z.object({ type: z.literal('CONNECT_REMOTE') }).strict(),
  z.object({ type: z.literal('DISCONNECT_REMOTE') }).strict(),
  z.object({ type: z.literal('CLEAR_REMOTE') }).strict(),
  z
    .object({
      type: z.literal('SET_SHARING'),
      pageId: z.string().uuid(),
      catalogVersion: z.string().uuid(),
      enabled: z.boolean(),
      toolNames: z.array(z.string().min(1).max(1024)).max(200),
    })
    .strict(),
  z.object({ type: z.literal('DISCOVER'), tabId: z.number().int().nonnegative() }).strict(),
  z
    .object({ type: z.literal('INVOKE'), ...target, arguments: z.record(z.string(), z.unknown()) })
    .strict(),
  z.object({ type: z.literal('SAVE_DEVICE'), name: z.string().trim().min(1).max(60) }).strict(),
]);
export type Command = z.infer<typeof CommandSchema>;
export const RequestSchema = z
  .object({ requestId: z.string().uuid(), command: CommandSchema })
  .strict();
export const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
export const label = (c: CallRecord) =>
  c.execution === 'unknown'
    ? '结果未知'
    : c.execution === 'rejected'
      ? '未发送拒绝'
      : c.execution === 'running'
        ? '执行中'
        : c.business === 'error'
          ? '业务错误'
          : c.late
            ? '后续已返回'
            : '已返回';
export const AdapterCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      target: z.literal('adapter'),
      type: z.literal('DISCOVER'),
      invalidate: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ target: z.literal('adapter'), type: z.literal('STATUS'), callId: z.string().uuid() })
    .strict(),
  z
    .object({
      target: z.literal('adapter'),
      type: z.literal('EXECUTE'),
      callId: z.string().uuid(),
      toolName: z.string().min(1).max(1024),
      version: z.string().uuid(),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
export const CatalogSchema = z
  .object({
    discovery: z.enum(['unsupported', 'ready_empty', 'ready', 'discovery_failed']),
    version: z.string().uuid(),
    error: z.string().max(8192).optional(),
    tools: z
      .array(
        z
          .object({
            name: z.string().min(1).max(1024),
            description: z.string().max(8192),
            inputSchema: z.union([z.boolean(), z.record(z.string(), z.unknown())]),
            executable: z.boolean(),
            unavailableReason: z.string().max(8192).optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export const SettledSchema = z
  .object({
    type: z.literal('CALL_SETTLED'),
    callId: z.string().uuid(),
    status: z.literal('settled'),
    result: z.unknown().optional(),
    errorCode: z
      .enum(['RESULT_TOO_LARGE', 'RESULT_UNSERIALIZABLE', 'EXECUTION_UNKNOWN', 'RESULT_RELEASED'])
      .optional(),
    business: z.enum(['error', 'unclassified']).optional(),
  })
  .strict();
