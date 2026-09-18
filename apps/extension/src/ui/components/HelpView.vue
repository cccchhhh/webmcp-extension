<script setup lang="ts">
import { t } from '../i18n';
defineEmits<{ tools: []; settings: [] }>();
</script>
<template>
  <div class="workspace-heading">
    <div>
      <div class="eyebrow">GET STARTED</div>
      <h2 tabindex="-1">{{ t('帮助与指南') }}</h2>
      <p>{{ t('从发现工具，到完成一次操作。') }}</p>
    </div>
    <span class="help-symbol">?</span>
  </div>
  <section class="help-intro">
    <span class="badge">{{ t('WebMCP 工具助手') }}</span>
    <h3>{{ t('你的页面，自带工具箱。') }}</h3>
    <p>
      {{
        t(
          '手动执行页面工具，或让 AI 帮你完成任务。AIChat 默认自动执行已授权工具，可切换逐次确认或撤销授权。',
        )
      }}
    </p>
  </section>
  <div class="section-head">
    <h3>{{ t('开始使用') }}</h3>
    <span class="muted">{{ t('三个步骤') }}</span>
  </div>
  <div
    v-for="(step, i) in [
      ['允许访问页面', '在 Tools 中授权当前站点，发现页面注册的工具。'],
      ['选择使用方式', '手动填写参数，或在 Settings 中配置模型后打开 AIChat。'],
      [
        '发送任务，查看结果',
        'AIChat 默认授权全部可用工具并自动执行；展开授权区域可调整范围、确认模式或撤销。',
      ],
    ]"
    :key="i"
    class="help-step"
  >
    <span>{{ i + 1 }}</span>
    <div>
      <strong>{{ t(step[0]) }}</strong>
      <p>{{ t(step[1]) }}</p>
    </div>
  </div>
  <h3 class="section-head">{{ t('常见问题') }}</h3>
  <details
    v-for="faq in [
      [
        '为什么页面没有工具？',
        '只有注册了受支持 WebMCP 工具的页面才会显示工具。Chrome 116 仅为扩展 API 下限；还需要浏览器提供 document.modelContext.getTools / executeTool 实验接口。',
      ],
      [
        'AIChat 需要桥接服务吗？',
        '不需要。内置 AIChat 直接连接配置的模型服务；远程桥接供外部 MCP 客户端访问页面工具。',
      ],
      [
        '如何启动远程桥接服务？',
        '本机启动需要 Node.js 24+。包发布到 npm 后，在终端执行 npx -y @webmcp/bridge。首次运行会自动初始化，每次启动成功后都会输出 MCP 地址、Agent 令牌和插件令牌；在 Settings 中填写 http://127.0.0.1:38472 和插件令牌，保存并开启连接。外部 MCP 客户端选择 Streamable HTTP，地址填写 http://127.0.0.1:38472/mcp，并使用独立 Agent 令牌配置 Authorization: Bearer <令牌>。保持终端运行，按 Ctrl+C 停止服务；再次启动会复用并显示已保存的令牌。远程 HTTPS 部署详见仓库文档。',
        'https://github.com/cccchhhh/webmcp-server',
        '查看 Bridge GitHub 仓库（在新标签页打开）',
      ],
      [
        'API Key 和对话保存在哪里？',
        'Key 默认仅保存在浏览器会话；主动选择记住后保存在本机，非系统密钥保险箱。聊天和授权工具定义、结果会发送到所选模型服务，服务端保留策略由该服务决定。聊天记录不跨浏览器重启保留。',
      ],
      [
        '页面共享与聊天授权有什么区别？',
        '远程共享保留自动共享全部可执行工具的行为，可关闭或取消单项授权。AIChat 默认授权全部兼容工具并自动执行，使用独立会话授权，二者互不启用。主动撤销后需手动恢复，重开侧栏不会恢复已撤销的授权。',
      ],
      [
        '结果未知时可以重试吗？',
        '不要直接重试。页面操作可能已经生效，应先检查业务状态。停止聊天仅阻止后续步骤，不能撤销已经发送的操作。',
      ],
      [
        '支持哪些模型？',
        '首版实现 OpenAI Chat Completions 兼容协议，需手填模型 ID。网关是否兼容须实测；未完成真实供应商联调前仅标记协议实现完成、待验收。',
      ],
    ]"
    :key="faq[0]"
    class="faq"
  >
    <summary>{{ t(faq[0]) }}</summary>
    <p>{{ t(faq[1]) }}</p>
    <a
      v-if="faq[2] && faq[3]"
      class="help-link"
      :href="faq[2]"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ t(faq[3]) }}
    </a>
  </details>
  <section class="help-privacy">
    <h3 class="section-head">{{ t('隐私说明') }}</h3>
    <a
      class="help-link"
      href="https://github.com/cccchhhh/webmcp-extension/blob/main/PRIVACY.md"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ t('查看隐私说明（在新标签页打开）') }}
    </a>
  </section>
  <button class="btn full" @click="$emit('tools')">{{ t('前往 Tools') }}</button>
</template>
<style scoped>
.help-link {
  color: var(--blue);
  font-size: 12px;
  line-height: 1.8;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.help-link:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 4px;
  border-radius: 2px;
}
</style>
