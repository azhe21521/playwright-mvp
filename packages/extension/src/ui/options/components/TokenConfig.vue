<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { BrowseIcon, BrowseOffIcon, CopyIcon, RefreshIcon } from 'tdesign-icons-vue-next';
import type { ExtensionConfig } from '@playwright-mvp/shared';

const props = defineProps<{
  config: ExtensionConfig;
  loading: boolean;
}>();

const emit = defineEmits<{
  save: [updates: Partial<ExtensionConfig>];
}>();

const token = ref(props.config.token);
const showToken = ref(false);
const copied = ref(false);

watch(() => props.config, (newConfig) => {
  token.value = newConfig.token;
});

const maskedToken = computed(() => {
  if (!token.value) return '';
  if (showToken.value) return token.value;
  return '•'.repeat(Math.min(token.value.length, 32));
});

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  token.value = result;
}

async function copyToken() {
  if (!token.value) return;
  await navigator.clipboard.writeText(token.value);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

function handleSave() {
  emit('save', { token: token.value });
}
</script>

<template>
  <div class="bg-white rounded-xl shadow-sm">
    <div class="p-6 border-b border-gray-100">
      <h2 class="text-subheading text-content">Token 设置</h2>
      <p class="text-body text-content-tertiary mt-1">配置身份验证 Token，用于与中转服务建立安全连接</p>
    </div>
    
    <div class="p-6 space-y-6">
      <!-- Token 输入 -->
      <div class="space-y-2">
        <label class="block text-sm font-medium text-content">身份验证 Token</label>
        <div class="relative">
          <t-input
            v-model="token"
            :type="showToken ? 'text' : 'password'"
            placeholder="输入或生成 Token"
            size="large"
            class="pr-24"
          />
          <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <t-button
              theme="default"
              variant="text"
              size="small"
              @click="showToken = !showToken"
            >
              <component :is="showToken ? BrowseOffIcon : BrowseIcon" />
            </t-button>
            <t-button
              theme="default"
              variant="text"
              size="small"
              @click="copyToken"
              :disabled="!token"
            >
              <CopyIcon />
            </t-button>
          </div>
        </div>
        <p v-if="copied" class="text-xs text-success">已复制到剪贴板</p>
        <p class="text-xs text-content-tertiary">
          Token 用于验证扩展与中转服务之间的连接，请确保与服务端配置的 Token 一致
        </p>
      </div>

      <!-- 生成按钮 -->
      <div class="flex items-center gap-4">
        <t-button
          variant="outline"
          @click="generateToken"
        >
          <template #icon><RefreshIcon /></template>
          生成随机 Token
        </t-button>
        <span class="text-sm text-content-tertiary">
          点击生成一个 32 位随机 Token
        </span>
      </div>

      <!-- 安全提示 -->
      <t-alert
        theme="warning"
        message="安全提示"
        :description="'Token 是敏感信息，请勿泄露给他人。建议定期更换 Token 以确保安全。'"
      />
    </div>

    <div class="p-6 border-t border-gray-100 flex justify-end">
      <t-button
        theme="primary"
        :loading="loading"
        @click="handleSave"
      >
        保存 Token
      </t-button>
    </div>
  </div>
</template>
