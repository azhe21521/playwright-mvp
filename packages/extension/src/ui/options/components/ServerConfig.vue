<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ExtensionConfig } from '@playwright-mvp/shared';

const props = defineProps<{
  config: ExtensionConfig;
  loading: boolean;
}>();

const emit = defineEmits<{
  save: [updates: Partial<ExtensionConfig>];
}>();

const relayServerUrl = ref(props.config.relayServerUrl);
const autoReconnect = ref(props.config.autoReconnect);
const reconnectInterval = ref(props.config.reconnectInterval);
const maxReconnectAttempts = ref(props.config.maxReconnectAttempts);

watch(() => props.config, (newConfig) => {
  relayServerUrl.value = newConfig.relayServerUrl;
  autoReconnect.value = newConfig.autoReconnect;
  reconnectInterval.value = newConfig.reconnectInterval;
  maxReconnectAttempts.value = newConfig.maxReconnectAttempts;
});

function handleSave() {
  emit('save', {
    relayServerUrl: relayServerUrl.value,
    autoReconnect: autoReconnect.value,
    reconnectInterval: reconnectInterval.value,
    maxReconnectAttempts: maxReconnectAttempts.value,
  });
}
</script>

<template>
  <div class="bg-white rounded-xl shadow-sm">
    <div class="p-6 border-b border-gray-100">
      <h2 class="text-subheading text-content">服务器配置</h2>
      <p class="text-body text-content-tertiary mt-1">配置中转服务器地址和重连策略</p>
    </div>
    
    <div class="p-6 space-y-6">
      <!-- 服务器地址 -->
      <div class="space-y-2">
        <label class="block text-sm font-medium text-content">中转服务 URL</label>
        <t-input
          v-model="relayServerUrl"
          placeholder="ws://localhost:3000"
          size="large"
        />
        <p class="text-xs text-content-tertiary">
          输入中转服务的 WebSocket 地址，如 ws://localhost:3000 或 wss://example.com:3000
        </p>
      </div>

      <!-- 自动重连 -->
      <div class="flex items-center justify-between p-4 bg-background-secondary rounded-lg">
        <div>
          <div class="font-medium text-content">自动重连</div>
          <div class="text-sm text-content-tertiary">连接断开后自动尝试重新连接</div>
        </div>
        <t-switch v-model="autoReconnect" />
      </div>

      <!-- 重连设置 -->
      <div v-if="autoReconnect" class="space-y-4 pl-4 border-l-2 border-primary/20">
        <div class="space-y-2">
          <label class="block text-sm font-medium text-content">重连间隔 (毫秒)</label>
          <t-slider
            v-model="reconnectInterval"
            :min="1000"
            :max="30000"
            :step="1000"
          />
          <div class="flex justify-between text-xs text-content-tertiary">
            <span>1秒</span>
            <span class="text-primary font-medium">{{ reconnectInterval / 1000 }}秒</span>
            <span>30秒</span>
          </div>
        </div>

        <div class="space-y-2">
          <label class="block text-sm font-medium text-content">最大重连次数</label>
          <t-input-number
            v-model="maxReconnectAttempts"
            :min="1"
            :max="100"
            theme="column"
          />
        </div>
      </div>
    </div>

    <div class="p-6 border-t border-gray-100 flex justify-end">
      <t-button
        theme="primary"
        :loading="loading"
        @click="handleSave"
      >
        保存配置
      </t-button>
    </div>
  </div>
</template>
