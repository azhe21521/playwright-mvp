<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { AddIcon, DeleteIcon, UploadIcon, DownloadIcon } from 'tdesign-icons-vue-next';
import type { ExtensionConfig } from '@playwright-mvp/shared';

const props = defineProps<{
  config: ExtensionConfig;
  loading: boolean;
}>();

const emit = defineEmits<{
  save: [updates: Partial<ExtensionConfig>];
}>();

const whitelist = ref<string[]>([...props.config.whitelist]);
const newRule = ref('');
const ruleError = ref<string | null>(null);

watch(() => props.config, (newConfig) => {
  whitelist.value = [...newConfig.whitelist];
});

const isValidRule = computed(() => {
  if (!newRule.value.trim()) return false;
  // 简单校验：不能只是通配符
  if (newRule.value.trim() === '*' || newRule.value.trim() === '**') return false;
  return true;
});

function addRule() {
  const rule = newRule.value.trim();
  if (!rule) {
    ruleError.value = '请输入白名单规则';
    return;
  }
  if (rule === '*' || rule === '**') {
    ruleError.value = '不允许使用纯通配符规则';
    return;
  }
  if (whitelist.value.includes(rule)) {
    ruleError.value = '规则已存在';
    return;
  }
  
  whitelist.value.push(rule);
  newRule.value = '';
  ruleError.value = null;
}

function removeRule(index: number) {
  whitelist.value.splice(index, 1);
}

function handleSave() {
  emit('save', { whitelist: whitelist.value });
}

async function exportRules() {
  const data = whitelist.value.join('\n');
  const blob = new Blob([data], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'whitelist-rules.txt';
  a.click();
  URL.revokeObjectURL(url);
}

function importRules() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    const text = await file.text();
    const rules = text.split('\n')
      .map((r) => r.trim())
      .filter((r) => r && r !== '*' && r !== '**');
    
    // 合并并去重
    const merged = [...new Set([...whitelist.value, ...rules])];
    whitelist.value = merged;
  };
  input.click();
}
</script>

<template>
  <div class="bg-white rounded-xl shadow-sm">
    <div class="p-6 border-b border-gray-100">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-subheading text-content">白名单管理</h2>
          <p class="text-body text-content-tertiary mt-1">
            配置允许访问的 URL 规则，支持通配符 (*) 匹配
          </p>
        </div>
        <div class="flex items-center gap-2">
          <t-button variant="outline" size="small" @click="importRules">
            <template #icon><UploadIcon /></template>
            导入
          </t-button>
          <t-button variant="outline" size="small" @click="exportRules" :disabled="!whitelist.length">
            <template #icon><DownloadIcon /></template>
            导出
          </t-button>
        </div>
      </div>
    </div>
    
    <div class="p-6 space-y-6">
      <!-- 添加规则 -->
      <div class="space-y-2">
        <label class="block text-sm font-medium text-content">添加白名单规则</label>
        <div class="flex gap-2">
          <t-input
            v-model="newRule"
            placeholder="例如: *.example.com 或 https://app.example.com/*"
            size="large"
            class="flex-1"
            @keyup.enter="addRule"
          />
          <t-button
            theme="primary"
            size="large"
            :disabled="!isValidRule"
            @click="addRule"
          >
            <AddIcon />
          </t-button>
        </div>
        <p v-if="ruleError" class="text-xs text-error">{{ ruleError }}</p>
        <p class="text-xs text-content-tertiary">
          支持通配符：* 匹配任意字符。例如 *.google.com 匹配所有 google.com 子域名
        </p>
      </div>

      <!-- 规则列表 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="block text-sm font-medium text-content">
            当前规则 ({{ whitelist.length }})
          </label>
          <span v-if="whitelist.length === 0" class="text-xs text-warning">
            空白名单将允许访问所有网址
          </span>
        </div>
        
        <div v-if="whitelist.length === 0" class="p-8 text-center bg-background-secondary rounded-lg">
          <div class="text-4xl mb-2">📋</div>
          <div class="text-content-secondary">暂无白名单规则</div>
          <div class="text-sm text-content-tertiary mt-1">添加规则以限制可访问的网址</div>
        </div>
        
        <div v-else class="space-y-2 max-h-80 overflow-y-auto">
          <div
            v-for="(rule, index) in whitelist"
            :key="index"
            class="flex items-center justify-between p-3 bg-background-secondary rounded-lg group hover:bg-background-tertiary transition-colors"
          >
            <code class="text-sm text-content font-mono">{{ rule }}</code>
            <t-button
              theme="danger"
              variant="text"
              size="small"
              class="opacity-0 group-hover:opacity-100 transition-opacity"
              @click="removeRule(index)"
            >
              <DeleteIcon />
            </t-button>
          </div>
        </div>
      </div>

      <!-- 示例 -->
      <t-collapse>
        <t-collapse-panel header="规则示例">
          <div class="space-y-2 text-sm">
            <div class="flex items-center gap-4">
              <code class="px-2 py-1 bg-gray-100 rounded">*.example.com</code>
              <span class="text-content-tertiary">匹配 example.com 所有子域名</span>
            </div>
            <div class="flex items-center gap-4">
              <code class="px-2 py-1 bg-gray-100 rounded">https://app.example.com/*</code>
              <span class="text-content-tertiary">匹配 app.example.com 下所有路径</span>
            </div>
            <div class="flex items-center gap-4">
              <code class="px-2 py-1 bg-gray-100 rounded">*://localhost:*</code>
              <span class="text-content-tertiary">匹配所有协议和端口的 localhost</span>
            </div>
          </div>
        </t-collapse-panel>
      </t-collapse>
    </div>

    <div class="p-6 border-t border-gray-100 flex justify-end">
      <t-button
        theme="primary"
        :loading="loading"
        @click="handleSave"
      >
        保存白名单
      </t-button>
    </div>
  </div>
</template>
