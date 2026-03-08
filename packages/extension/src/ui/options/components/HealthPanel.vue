<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { RefreshIcon, WifiIcon, WifiOffIcon, TimeIcon } from 'tdesign-icons-vue-next';
import type { ExtensionMessage, ExtensionMessageResponse } from '../../../types/index.js';

interface ExtensionState {
  connectionState: string;
  sessionId: string | null;
  reconnectAttempts: number;
  config: {
    relayServerUrl: string;
    hasToken: boolean;
    whitelistCount: number;
    autoReconnect: boolean;
  };
  attachedTabs: Array<{
    tabId: number;
    title: string;
    url: string;
  }>;
}

const state = ref<ExtensionState | null>(null);
const loading = ref(false);
const lastUpdate = ref<Date | null>(null);
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// Playwright MCP Tools 列表
const tools = [
  { name: 'browser_navigate', description: '导航到指定 URL', category: '导航' },
  { name: 'browser_click', description: '点击页面元素', category: '交互' },
  { name: 'browser_type', description: '在输入框中输入文本', category: '交互' },
  { name: 'browser_screenshot', description: '截取页面截图', category: '截图' },
  { name: 'browser_snapshot', description: '获取页面可访问性快照', category: '截图' },
  { name: 'browser_evaluate', description: '在页面中执行 JavaScript', category: '脚本' },
  { name: 'browser_wait', description: '等待指定条件', category: '等待' },
  { name: 'browser_press_key', description: '按下键盘按键', category: '交互' },
  { name: 'browser_select_option', description: '选择下拉框选项', category: '交互' },
  { name: 'browser_hover', description: '悬停在元素上', category: '交互' },
  { name: 'browser_drag', description: '拖拽元素', category: '交互' },
  { name: 'browser_resize', description: '调整浏览器窗口大小', category: '窗口' },
  { name: 'browser_file_upload', description: '上传文件', category: '文件' },
  { name: 'browser_handle_dialog', description: '处理对话框', category: '对话框' },
  { name: 'browser_tab_list', description: '获取 Tab 列表', category: 'Tab' },
  { name: 'browser_tab_new', description: '创建新 Tab', category: 'Tab' },
  { name: 'browser_tab_select', description: '切换 Tab', category: 'Tab' },
  { name: 'browser_tab_close', description: '关闭 Tab', category: 'Tab' },
];

async function sendMessage(message: ExtensionMessage): Promise<ExtensionMessageResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

async function loadState() {
  loading.value = true;
  const response = await sendMessage({ type: 'GET_STATE' });
  if (response.success) {
    state.value = response.data as ExtensionState;
    lastUpdate.value = new Date();
  }
  loading.value = false;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'connected': return 'success';
    case 'connecting': return 'warning';
    case 'error': return 'error';
    default: return 'default';
  }
}

function getStatusText(status: string) {
  switch (status) {
    case 'connected': return '已连接';
    case 'connecting': return '连接中';
    case 'error': return '连接失败';
    default: return '未连接';
  }
}

onMounted(() => {
  loadState();
  // 每 5 秒刷新一次
  refreshInterval = setInterval(loadState, 5000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
</script>

<template>
  <div class="space-y-6">
    <!-- 连接状态卡片 -->
    <div class="bg-white rounded-xl shadow-sm">
      <div class="p-6 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 class="text-subheading text-content">连接状态</h2>
          <p class="text-body text-content-tertiary mt-1">查看与中转服务的连接状态</p>
        </div>
        <t-button variant="outline" :loading="loading" @click="loadState">
          <template #icon><RefreshIcon /></template>
          刷新
        </t-button>
      </div>
      
      <div class="p-6">
        <div class="grid grid-cols-2 gap-4">
          <!-- 连接状态 -->
          <div class="p-4 bg-background-secondary rounded-lg">
            <div class="flex items-center gap-3 mb-2">
              <component 
                :is="state?.connectionState === 'connected' ? WifiIcon : WifiOffIcon"
                :class="state?.connectionState === 'connected' ? 'text-success' : 'text-content-tertiary'"
                class="w-6 h-6"
              />
              <span class="font-medium text-content">连接状态</span>
            </div>
            <t-tag 
              :theme="getStatusColor(state?.connectionState || 'disconnected')"
              size="large"
            >
              {{ getStatusText(state?.connectionState || 'disconnected') }}
            </t-tag>
          </div>

          <!-- 服务器地址 -->
          <div class="p-4 bg-background-secondary rounded-lg">
            <div class="text-sm text-content-tertiary mb-2">服务器地址</div>
            <div class="font-mono text-sm text-content truncate">
              {{ state?.config?.relayServerUrl || '-' }}
            </div>
          </div>

          <!-- 会话 ID -->
          <div class="p-4 bg-background-secondary rounded-lg">
            <div class="text-sm text-content-tertiary mb-2">会话 ID</div>
            <div class="font-mono text-xs text-content truncate">
              {{ state?.sessionId || '-' }}
            </div>
          </div>

          <!-- 已附加 Tab -->
          <div class="p-4 bg-background-secondary rounded-lg">
            <div class="text-sm text-content-tertiary mb-2">已附加 Tab</div>
            <div class="text-2xl font-bold text-primary">
              {{ state?.attachedTabs?.length || 0 }}
            </div>
          </div>
        </div>

        <!-- 最后更新时间 -->
        <div v-if="lastUpdate" class="mt-4 flex items-center gap-2 text-xs text-content-tertiary">
          <TimeIcon class="w-3 h-3" />
          <span>最后更新: {{ lastUpdate.toLocaleTimeString() }}</span>
        </div>
      </div>
    </div>

    <!-- Tools 列表 -->
    <div class="bg-white rounded-xl shadow-sm">
      <div class="p-6 border-b border-gray-100">
        <h2 class="text-subheading text-content">可用 Tools</h2>
        <p class="text-body text-content-tertiary mt-1">
          Playwright MCP 提供的浏览器自动化工具列表
        </p>
      </div>
      
      <div class="p-6">
        <t-table
          :data="tools"
          :columns="[
            { colKey: 'name', title: 'Tool 名称', width: 200 },
            { colKey: 'description', title: '描述' },
            { colKey: 'category', title: '分类', width: 100 },
          ]"
          size="small"
          :hover="true"
          :stripe="true"
          max-height="400"
        >
          <template #name="{ row }">
            <code class="text-xs px-2 py-1 bg-gray-100 rounded">{{ row.name }}</code>
          </template>
          <template #category="{ row }">
            <t-tag size="small" variant="light">{{ row.category }}</t-tag>
          </template>
        </t-table>
      </div>
    </div>
  </div>
</template>
