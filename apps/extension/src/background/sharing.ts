import type { Page } from '../../../../packages/protocol';
import type { Sharing } from '../../../../packages/protocol/remote';

export function defaultSharing(page: Page, current?: Sharing): Sharing | undefined {
  if (!['ready', 'ready_empty'].includes(page.discovery)) return current;
  if (current && (!current.autoAll || !current.enabled)) return current;
  const names = page.tools.filter((tool) => tool.executable).map((tool) => tool.name);
  if (
    current?.nativeVersion === page.catalogVersion &&
    JSON.stringify(current.authorizedToolNames) === JSON.stringify(names)
  )
    return current;
  return {
    enabled: true,
    autoAll: true,
    authorizedToolNames: names,
    catalogVersion: crypto.randomUUID(),
    nativeVersion: page.catalogVersion,
  };
}
