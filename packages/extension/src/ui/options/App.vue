<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import TokenConfig from './components/TokenConfig.vue';
import ServerConfig from './components/ServerConfig.vue';
import WhitelistConfig from './components/WhitelistConfig.vue';
import HealthPanel from './components/HealthPanel.vue';
import { 
  SettingIcon, 
  LockOnIcon, 
  ListIcon, 
  DashboardIcon 
} from 'tdesign-icons-vue-next';
import type { ExtensionConfig } from '@playwright-mvp/shared';
import type { ExtensionMessage, ExtensionMessageResponse } from '../../types/index.js';

const activeTab = ref('server');
const config = ref<ExtensionConfig | null>(null);
const loading = ref(false);
const saveMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);

const tabs = [
  { value: 'server', label: '服务器配置', icon: SettingIcon },
  { value: 'token', label: 'Token 设置', icon: LockOnIcon },
  { value: 'whitelist', label: '白名单管理', icon: ListIcon },
  { value: 'health', label: '健康监控', icon: DashboardIcon },
];

async function sendMessage(message: ExtensionMessage): Promise<ExtensionMessageResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

async function loadConfig() {
  loading.value = true;
  const response = await sendMessage({ type: 'GET_CONFIG' });
  if (response.success) {
    config.value = response.data as ExtensionConfig;
  }
  loading.value = false;
}

async function saveConfig(updates: Partial<ExtensionConfig>) {
  loading.value = true;
  saveMessage.value = null;
  
  const response = await sendMessage({ 
    type: 'SET_CONFIG', 
    payload: updates 
  });
  
  if (response.success) {
    saveMessage.value = { type: 'success', text: '配置已保存' };
    await loadConfig();
  } else {
    saveMessage.value = { type: 'error', text: response.error || '保存失败' };
  }
  
  loading.value = false;
  
  // 3秒后清除消息
  setTimeout(() => {
    saveMessage.value = null;
  }, 3000);
}

onMounted(() => {
  loadConfig();
});
</script>

<template>
  <div class="min-h-screen bg-background-secondary">
    <!-- 顶部导航 -->
    <header class="bg-white shadow-sm sticky top-0 z-10">
      <div class="max-w-4xl mx-auto px-6 py-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-light flex items-center justify-center">
            <span class="text-white font-bold text-lg">P</span>
          </div>
          <div>
            <h1 class="text-heading text-content">Playwright MVP 配置</h1>
            <p class="text-body text-content-tertiary">配置中转服务连接和白名单规则</p>
          </div>
        </div>
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="max-w-4xl mx-auto px-6 py-6">
      <div class="flex gap-6">
        <!-- 左侧导航 -->
        <nav class="w-48 flex-shrink-0">
          <div class="bg-white rounded-xl p-2 shadow-sm sticky top-24">
            <button
              v-for="tab in tabs"
              :key="tab.value"
              :class="[
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all',
                activeTab === tab.value
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-content-secondary hover:bg-background-secondary'
              ]"
              @click="activeTab = tab.value"
            >
              <component :is="tab.icon" class="w-5 h-5" />
              {{ tab.label }}
            </button>
          </div>
        </nav>

        <!-- 右侧内容 -->
        <div class="flex-1 min-w-0">
          <!-- 保存提示 -->
          <t-alert
            v-if="saveMessage"
            :theme="saveMessage.type"
            :message="saveMessage.text"
            class="mb-4"
            close
          />

          <!-- 加载状态 -->
          <div v-if="loading && !config" class="bg-white rounded-xl p-8 shadow-sm text-center">
            <t-loading />
            <p class="mt-4 text-content-secondary">加载配置中...</p>
          </div>

          <!-- 配置面板 -->
          <template v-else-if="config">
            <ServerConfig
              v-show="activeTab === 'server'"
              :config="config"
              :loading="loading"
              @save="saveConfig"
            />
            <TokenConfig
              v-show="activeTab === 'token'"
              :config="config"
              :loading="loading"
              @save="saveConfig"
            />
            <WhitelistConfig
              v-show="activeTab === 'whitelist'"
              :config="config"
              :loading="loading"
              @save="saveConfig"
            />
            <HealthPanel
              v-show="activeTab === 'health'"
            />
          </template>
        </div>
      </div>
    </main>
  </div>
</template>
