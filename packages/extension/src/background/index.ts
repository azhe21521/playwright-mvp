/**
 * Chrome 扩展 Service Worker 入口
 * 
 * 该扩展作为 CDP Bridge 的客户端，接收来自 Bridge Server 的 CDP 命令，
 * 通过 chrome.debugger API 执行，并将结果返回。
 */
import { initRelayConnection, connect, disconnect, getConnectionInfo, getAttachedTabs } from './relay-connection.js';
import { initWhitelistInterceptor, updateWhitelist } from './whitelist.js';
import { getConfig, saveConfig } from '../storage/config-storage.js';
import type { ExtensionMessage, ExtensionMessageResponse, TabInfo } from '../types/index.js';

console.log('[Background] Service Worker 启动');

/**
 * 初始化扩展
 */
async function initialize(): Promise<void> {
  console.log('[Background] 初始化扩展...');
  
  // 初始化各模块
  initRelayConnection();
  await initWhitelistInterceptor();
  
  // 尝试自动连接（如果有配置）
  const config = await getConfig();
  if (config.relayServerUrl && config.autoReconnect) {
    try {
      await connect();
      console.log('[Background] 自动连接成功');
    } catch (error) {
      console.log('[Background] 自动连接失败，等待手动连接');
    }
  }
  
  console.log('[Background] 扩展初始化完成');
}

/**
 * 处理来自 Popup/Options 的消息
 */
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionMessageResponse) => void
  ) => {
    handleMessage(message)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    
    // 返回 true 表示异步响应
    return true;
  }
);

/**
 * 处理消息
 */
async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATE': {
      const config = await getConfig();
      const connectionInfo = getConnectionInfo();
      const attachedTabsList = getAttachedTabs();
      
      return {
        connectionState: connectionInfo.state,
        attachedTabs: connectionInfo.attachedTabs,
        reconnectAttempts: connectionInfo.reconnectAttempts,
        config: {
          relayServerUrl: config.relayServerUrl,
          hasToken: !!config.token,
          whitelistCount: config.whitelist.length,
          autoReconnect: config.autoReconnect,
        },
        tabs: attachedTabsList,
      };
    }
    
    case 'GET_CONFIG': {
      return getConfig();
    }
    
    case 'SET_CONFIG': {
      const payload = message.payload as Partial<{
        relayServerUrl: string;
        token: string;
        whitelist: string[];
        autoReconnect: boolean;
        reconnectInterval: number;
        maxReconnectAttempts: number;
      }>;
      
      await saveConfig(payload);
      
      // 如果更新了白名单，立即生效
      if (payload.whitelist) {
        updateWhitelist(payload.whitelist);
      }
      
      return { success: true };
    }
    
    case 'CONNECT': {
      await connect();
      return { success: true };
    }
    
    case 'DISCONNECT': {
      disconnect();
      return { success: true };
    }
    
    case 'GET_TABS': {
      const allTabs = await chrome.tabs.query({});
      const attachedTabsList = getAttachedTabs();
      
      const tabs: TabInfo[] = allTabs.map((tab) => ({
        tabId: tab.id!,
        title: tab.title ?? '',
        url: tab.url ?? '',
        attached: attachedTabsList.some((t) => t.tabId === tab.id),
      }));
      
      return { tabs };
    }
    
    default:
      throw new Error(`未知消息类型: ${(message as ExtensionMessage).type}`);
  }
}

// 初始化扩展
initialize().catch((error) => {
  console.error('[Background] 初始化失败:', error);
});

// 监听扩展安装/更新
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] 扩展已安装/更新:', details.reason);
});

// 监听扩展启动
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] 浏览器启动');
  initialize().catch((error) => {
    console.error('[Background] 启动初始化失败:', error);
  });
});
