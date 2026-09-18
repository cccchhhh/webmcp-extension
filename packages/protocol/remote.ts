import { z } from 'zod';
import type { Target } from './bridge-v1';
export * from './bridge-v1';
const id = z.string().uuid();
export type RemoteConfig = {
  connectionType: 'bridge';
  baseUrl: string;
  mode: 'local' | 'remote';
  deviceId: string;
  token: string;
  enabled: boolean;
};
export interface RemoteState {
  connectionType: 'bridge';
  baseUrl: string;
  mode: 'local' | 'remote';
  deviceId: string;
  enabled: boolean;
  hasToken: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'attention';
  error?: string;
}
export interface Sharing {
  autoAll?: boolean;
  enabled: boolean;
  authorizedToolNames: string[];
  catalogVersion: string;
  nativeVersion: string;
}
export const emptyRemote = (): RemoteState => ({
  connectionType: 'bridge',
  baseUrl: 'http://127.0.0.1:38472',
  mode: 'local',
  deviceId: '',
  enabled: false,
  hasToken: false,
  status: 'disconnected',
});
export function serviceOrigin(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw Error('INVALID_SERVICE_URL');
  }
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/' ||
    !(
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
    )
  )
    throw Error('INVALID_SERVICE_URL');
  return u.origin;
}
export const RemoteSettingsSchema = z
  .object({
    connectionType: z.literal('bridge').default('bridge'),
    baseUrl: z
      .string()
      .max(8192)
      .transform((value, ctx) => {
        try {
          return serviceOrigin(value);
        } catch {
          ctx.addIssue({ code: 'custom', message: 'INVALID_SERVICE_URL' });
          return z.NEVER;
        }
      }),
    mode: z.enum(['local', 'remote']),
    deviceId: z.union([id, z.literal('')]),
    token: z.string().trim().max(16384).optional(),
  })
  .strict();
export type RemoteSettings = z.input<typeof RemoteSettingsSchema>;
export const sameTarget = (a: Target, b: Target) =>
  a.pageId === b.pageId &&
  a.localPageId === b.localPageId &&
  a.documentId === b.documentId &&
  a.catalogVersion === b.catalogVersion;
