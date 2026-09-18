import type { Page } from '../../../../packages/protocol';
import type { ModelProfile } from '../../../../packages/protocol/chat';
import type { ChatRuntime } from './chat-runtime';
import { compatibleTools, catalog } from './tool-catalog';

/** One coordinator per runtime, so view remounts never reset a user's choice. */
export class ChatAuthorization {
  names: string[] = [];
  mode: 'auto' | 'confirm' = 'auto';
  pending = false;
  editing = false;
  notice = '';
  private sessionId = '';
  private attempt = '';
  private suspended = false;
  constructor(private runtime: ChatRuntime) {}
  private initialize(page?: Page) {
    if (this.sessionId === this.runtime.session.id) return;
    this.sessionId = this.runtime.session.id;
    this.attempt = '';
    this.suspended = false;
    const scope = this.runtime.session.authorization;
    this.names =
      scope?.toolNames.slice() ??
      compatibleTools(page?.tools ?? [])
        .filter((x) => !x.reason)
        .map((x) => x.tool.name);
    this.mode = scope?.mode ?? 'auto';
    this.editing = !!scope?.revoked;
    this.notice = scope?.revoked ? '本会话授权已撤销，可手动恢复。' : '';
  }
  configurationChanged() {
    this.attempt = '';
    this.notice = '';
    this.runtime.notify();
  }
  async sync(profile: ModelProfile | undefined, page: Page | undefined) {
    this.initialize(page);
    if (this.pending) return;
    const r = this.runtime,
      target = r.session.target;
    if (
      target &&
      (!page ||
        page.pageId !== target.pageId ||
        page.documentId !== target.documentId ||
        page.catalogVersion !== target.catalogVersion)
    ) {
      if (!this.suspended) {
        this.suspended = true;
        this.names = compatibleTools(page?.tools ?? [])
          .filter((x) => !x.reason)
          .map((x) => x.tool.name);
        this.editing = true;
        this.notice = '页面或工具已变化；请重新绑定当前目录，或新建对话。';
        this.pending = true;
        r.notify();
        try {
          await r.stop();
          await r.revoke();
        } finally {
          this.pending = false;
          r.notify();
        }
      }
      return;
    }
    if (r.busy || r.grantId || r.session.authorization?.revoked || this.suspended) return;
    if (!profile || !page) {
      const message = !profile ? '请先配置并选择模型。' : '正在等待页面发现。';
      if (this.notice !== message) {
        this.notice = message;
        r.notify();
      }
      return;
    }
    const key = [
      r.session.id,
      profile.id,
      profile.version,
      profile.credentialId,
      page.pageId,
      page.documentId,
      page.catalogVersion,
      page.discovery,
    ].join('/');
    if (this.attempt === key) return;
    this.attempt = key;
    if (!r.session.authorization?.customized)
      this.names = compatibleTools(page.tools)
        .filter((x) => !x.reason)
        .map((x) => x.tool.name);
    await this.establish(profile, page, false, !!r.session.authorization?.customized);
  }
  private async establish(
    profile: ModelProfile,
    page: Page | undefined,
    takeover: boolean,
    customized: boolean,
  ) {
    if (this.pending) return;
    this.pending = true;
    this.notice = '';
    this.runtime.notify();
    try {
      if (!(await this.runtime.hasCredential(profile)))
        throw Error('缺少 API Key，请在模型设置中重新填写。');
      catalog(page?.tools ?? [], this.names);
      await this.runtime.grant(profile, page, this.names, this.mode, takeover, customized);
      this.editing = false;
      this.suspended = false;
    } catch (e) {
      this.notice = e instanceof Error ? e.message : '授权失败';
      this.editing = true;
    } finally {
      this.pending = false;
      this.runtime.notify();
    }
  }
  async apply(profile: ModelProfile | undefined, page: Page | undefined, takeover = false) {
    if (!profile) {
      this.notice = '请先配置并选择模型。';
      this.runtime.notify();
      return;
    }
    await this.establish(profile, page, takeover, true);
  }
  async edit() {
    if (this.pending) return;
    this.pending = true;
    this.editing = true;
    try {
      await this.runtime.revokeForSession();
      this.notice = '修改工具范围或执行方式后，点击应用并恢复授权。';
    } catch (e) {
      this.notice = e instanceof Error ? e.message : '撤销授权失败';
    } finally {
      this.pending = false;
      this.runtime.notify();
    }
  }
  async revoke() {
    await this.edit();
    this.notice = '本会话授权已撤销，不会自动重新开启。';
    this.runtime.notify();
  }
  setNames(names: string[]) {
    this.names = [...names];
    this.runtime.notify();
  }
  setMode(mode: 'auto' | 'confirm') {
    this.mode = mode;
    this.runtime.notify();
  }
}
