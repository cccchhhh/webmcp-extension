import { describe, expect, it } from 'vitest';
import { defaultSharing } from '../apps/extension/src/background/sharing';
import type { Page } from '../packages/protocol';
const page = {
  discovery: 'ready',
  catalogVersion: 'v1',
  tools: [
    { name: 'one', executable: true },
    { name: 'invalid', executable: false },
  ],
} as Page;
describe('default page sharing', () => {
  it('shares discovered pages and all executable tools, including new tools', () => {
    const initial = defaultSharing(page)!;
    expect(initial.enabled).toBe(true);
    expect(initial.authorizedToolNames).toEqual(['one']);
    const next = defaultSharing(
      { ...page, catalogVersion: 'v2', tools: [...page.tools, { ...page.tools[0], name: 'two' }] },
      initial,
    )!;
    expect(next.authorizedToolNames).toEqual(['one', 'two']);
    expect(next.catalogVersion).not.toBe(initial.catalogVersion);
    expect(defaultSharing(page, initial)).toBe(initial);
  });
  it('preserves manual exclusions and disabled sharing, and ignores inaccessible pages', () => {
    const manual = { ...defaultSharing(page)!, autoAll: false, authorizedToolNames: [] };
    expect(defaultSharing(page, manual)).toBe(manual);
    const disabled = { ...manual, enabled: false };
    expect(defaultSharing(page, disabled)).toBe(disabled);
    expect(defaultSharing({ ...page, discovery: 'permission_required' })).toBeUndefined();
    expect(defaultSharing({ ...page, discovery: 'ready_empty', tools: [] })?.enabled).toBe(true);
  });
});
