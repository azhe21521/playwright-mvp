<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { 
  WifiIcon, 
  WifiOffIcon, 
  SettingIcon, 
  RefreshIcon,
  LinkIcon,
  LinkUnlinkIcon,
  TimeIcon
} from 'tdesign-icons-vue-next';
import type { ExtensionMessage, ExtensionMessageResponse } from '../../types/index.js';

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
const error = ref<string | null>(null);

const statusText = computed(() => {
  if (!state.value) return '加载中...';
  switch (state.value.connectionState) {
    case 'connected': return '已连接';
    case 'connecting': return '连接中...';
    case 'error': return '连接失败';
    default: return '未连接';
  }
});

const statusColor = computed(() => {
  if (!state.value) return 'bg-gray-400';
  switch (state.value.connectionState) {
    case 'connected': return 'bg-green-500';
    case 'connecting': return 'bg-yellow-500';
    case 'error': return 'bg-red-500';
    default: return 'bg-gray-400';
  }
});

async function sendMessage(message: ExtensionMessage): Promise<ExtensionMessageResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

async function loadState() {
  loading.value = true;
  error.value = null;
  
  const response = await sendMessage({ type: 'GET_STATE' });
  if (response.success) {
    state.value = response.data as ExtensionState;
  } else {
    error.value = response.error || '获取状态失败';
  }
  
  loading.value = false;
}

async function handleConnect() {
  if (!state.value) return;
  
  loading.value = true;
  
  if (state.value.connectionState === 'connected') {
    await sendMessage({ type: 'DISCONNECT' });
  } else {
    const response = await sendMessage({ type: 'CONNECT' });
    if (!response.success) {
      error.value = response.error || '连接失败';
    }
  }
  
  await loadState();
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

onMounted(() => {
  loadState();
});
</script>

<template>
  <div class="w-[360px] bg-white">
    <!-- 顶部状态栏 -->
    <div class="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary to-primary-light">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
          <span class="text-white font-bold text-sm">P</span>
        </div>
        <span class="text-white font-semibold">Playwright MVP</span>
      </div>
      <div class="flex items-center gap-2">
        <div :class="['w-2.5 h-2.5 rounded-full', statusColor]"></div>
        <span class="text-white/90 text-sm">{{ statusText }}</span>
      </div>
    </div>

    <!-- 连接信息 -->
    <div class="p-4 space-y-4">
      <!-- 服务器信息 -->
      <div class="bg-background-secondary rounded-lg p-3">
        <div class="flex items-center gap-2 text-content-secondary text-sm mb-2">
          <component :is="state?.connectionState === 'connected' ? WifiIcon : WifiOffIcon" />
          <span>中转服务</span>
        </div>
        <div class="text-content font-mono text-sm truncate">
          {{ state?.config?.relayServerUrl || 'ws://localhost:3000' }}
        </div>
        <div v-if="state?.sessionId" class="mt-2 text-xs text-content-tertiary">
          会话: {{ state.sessionId.substring(0, 20) }}...
        </div>
      </div>

      <!-- 已附加的 Tab -->
      <div v-if="state?.attachedTabs?.length" class="bg-background-secondary rounded-lg p-3">
        <div class="flex items-center gap-2 text-content-secondary text-sm mb-2">
          <LinkIcon />
          <span>已连接 Tab ({{ state.attachedTabs.length }})</span>
        </div>
        <div class="space-y-2 max-h-32 overflow-y-auto">
          <div 
            v-for="tab in state.attachedTabs" 
            :key="tab.tabId"
            class="flex items-center gap-2 text-sm"
          >
            <div class="w-4 h-4 rounded bg-green-100 flex items-center justify-center">
              <div class="w-2 h-2 rounded-full bg-green-500"></div>
            </div>
            <span class="truncate text-content-secondary">{{ tab.title || tab.url }}</span>
          </div>
        </div>
      </div>

      <!-- 配置摘要 -->
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-background-secondary rounded-lg p-3 text-center">
          <div class="text-2xl font-bold text-primary">{{ state?.config?.whitelistCount || 0 }}</div>
          <div class="text-xs text-content-tertiary">白名单规则</div>
        </div>
        <div class="bg-background-secondary rounded-lg p-3 text-center">
          <div class="text-2xl font-bold" :class="state?.config?.hasToken ? 'text-green-500' : 'text-gray-400'">
            {{ state?.config?.hasToken ? '✓' : '✗' }}
          </div>
          <div class="text-xs text-content-tertiary">Token 配置</div>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="bg-red-50 text-red-600 rounded-lg p-3 text-sm">
        {{ error }}
      </div>

      <!-- 操作按钮 -->
      <div class="flex gap-3">
        <t-button
          :theme="state?.connectionState === 'connected' ? 'danger' : 'primary'"
          :loading="loading"
          block
          @click="handleConnect"
        >
          <template #icon>
            <component :is="state?.connectionState === 'connected' ? LinkUnlinkIcon : LinkIcon" />
          </template>
          {{ state?.connectionState === 'connected' ? '断开连接' : '连接服务' }}
        </t-button>
        <t-button theme="default" @click="openOptions">
          <SettingIcon />
        </t-button>
        <t-button theme="default" :loading="loading" @click="loadState">
          <RefreshIcon />
        </t-button>
      </div>
    </div>

    <!-- 底部状态 -->
    <div class="px-4 py-2 border-t border-gray-100 flex items-center justify-between text-xs text-content-tertiary">
      <div class="flex items-center gap-1">
        <TimeIcon class="w-3 h-3" />
        <span>v1.0.0</span>
      </div>
      <span v-if="state?.config?.autoReconnect">自动重连已启用</span>
    </div>
  </div>
</template>
