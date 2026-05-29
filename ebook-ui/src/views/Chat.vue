<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import request from '@/api/request';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoningContent?: string;
  timestamp: number;
}

interface ChatSession {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
}

// 状态定义
const sessions = ref<ChatSession[]>([]);
const activeSessionId = ref<string>('');
const userInput = ref<string>('');
const loading = ref<boolean>(false);
const activeModelInfo = ref({
  name: '正在加载模型...',
  model: '',
  isReasoning: false,
  url: ''
});

// 自定义确认弹窗控制
const showDeleteConfirm = ref<boolean>(false);
const sessionToDeleteId = ref<string>('');
const sessionToDeleteName = ref<string>('');

const showClearConfirm = ref<boolean>(false);

// UI 控制状态
const editingSessionId = ref<string>('');
const editSessionName = ref<string>('');
const messagesContainer = ref<HTMLElement | null>(null);
const renameInput = ref<HTMLElement | null>(null);
const abortController = ref<AbortController | null>(null);

// 计算当前选中的会话
const activeSession = computed(() => {
  return sessions.value.find(s => s.id === activeSessionId.value) || null;
});

// 监听会话变更，同步持久化到 localStorage
watch(sessions, (newSessions) => {
  localStorage.setItem('voiceforge.chat.sessions', JSON.stringify(newSessions));
}, { deep: true });

watch(activeSessionId, (newId) => {
  localStorage.setItem('voiceforge.chat.activeSessionId', newId);
  nextTick(() => {
    scrollToBottom();
  });
});

// 初始化加载会话和默认激活模型信息
onMounted(async () => {
  // 1. 加载激活的 AI 模型信息
  await fetchActiveModelInfo();

  // 2. 从本地缓存加载会话
  const cachedSessions = localStorage.getItem('voiceforge.chat.sessions');
  const cachedActiveId = localStorage.getItem('voiceforge.chat.activeSessionId');

  if (cachedSessions) {
    try {
      sessions.value = JSON.parse(cachedSessions);
    } catch (e) {
      console.error('Failed to parse cached chat sessions:', e);
      sessions.value = [];
    }
  }

  if (sessions.value.length === 0) {
    // 若无会话，创建一个默认对话
    createNewSession();
  } else {
    if (cachedActiveId && sessions.value.some(s => s.id === cachedActiveId)) {
      activeSessionId.value = cachedActiveId;
    } else {
      activeSessionId.value = sessions.value[0].id;
    }
  }

  nextTick(() => {
    scrollToBottom();
  });
});

// 获取大模型信息
const fetchActiveModelInfo = async () => {
  try {
    const res = await request.get('/chat/model') as any;
    if (res) {
      activeModelInfo.value = {
        name: res.name || '系统默认配置',
        model: res.model || '',
        isReasoning: Boolean(res.isReasoning),
        url: res.url || ''
      };
    }
  } catch (error) {
    console.error('获取模型配置失败:', error);
    activeModelInfo.value.name = '无法获取当前配置 (回退环境配置)';
  }
};

// 新建会话
const createNewSession = () => {
  const newSession: ChatSession = {
    id: `session_${Date.now()}`,
    name: `新对话 ${sessions.value.length + 1}`,
    messages: [],
    createdAt: Date.now()
  };
  sessions.value.unshift(newSession);
  activeSessionId.value = newSession.id;
  nextTick(() => {
    scrollToBottom();
  });
};

// 自定义删除会话模态逻辑
const deleteSession = (sessionId: string, event: Event) => {
  event.stopPropagation();
  const session = sessions.value.find(s => s.id === sessionId);
  if (!session) return;

  sessionToDeleteId.value = sessionId;
  sessionToDeleteName.value = session.name;
  showDeleteConfirm.value = true;
};

const confirmDeleteSession = () => {
  const sessionId = sessionToDeleteId.value;
  const index = sessions.value.findIndex(s => s.id === sessionId);
  if (index !== -1) {
    sessions.value.splice(index, 1);
    
    // 如果删除的是当前处于激活状态的会话
    if (activeSessionId.value === sessionId) {
      if (sessions.value.length > 0) {
        activeSessionId.value = sessions.value[0].id;
      } else {
        createNewSession();
      }
    }
  }
  showDeleteConfirm.value = false;
  sessionToDeleteId.value = '';
  sessionToDeleteName.value = '';
};

const cancelDeleteSession = () => {
  showDeleteConfirm.value = false;
  sessionToDeleteId.value = '';
  sessionToDeleteName.value = '';
};

// 原地重命名会话相关
const startEditingSession = (session: ChatSession, event: Event) => {
  event.stopPropagation();
  editingSessionId.value = session.id;
  editSessionName.value = session.name;
  nextTick(() => {
    if (renameInput.value) {
      renameInput.value.focus();
    }
  });
};

const saveSessionName = (session: ChatSession) => {
  if (editSessionName.value.trim()) {
    session.name = editSessionName.value.trim();
  }
  editingSessionId.value = '';
};

const cancelEditingSession = () => {
  editingSessionId.value = '';
};

// 消息平滑滚动到底部
const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTo({
      top: messagesContainer.value.scrollHeight,
      behavior: 'smooth'
    });
  }
};

// 格式化渲染 Markdown（支持多行代码块、行内代码、粗体、斜体、换行）
const formatMessageContent = (text: string) => {
  if (!text) return '';
  // 转义 HTML 防止 XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  // 渲染多行代码块 ```javascript\n code ```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `
      <div class="code-block-wrapper">
        <div class="code-header">
          <span class="code-lang">${lang || 'code'}</span>
        </div>
        <pre class="mono-text"><code>${code.trim()}</code></pre>
      </div>
    `;
  });
  
  // 渲染行内代码 `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code mono-text">$1</code>');
  
  // 渲染粗体 **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // 渲染斜体 *italic*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // 替换换行为 br
  html = html.replace(/\n/g, '<br>');
  
  return html;
};

// 停止当前 AI 的生成
const stopGeneration = () => {
  if (abortController.value) {
    abortController.value.abort();
    loading.value = false;
  }
};

// 自定义清除上下文模态逻辑
const clearCurrentSessionContext = () => {
  if (!activeSession.value) return;
  showClearConfirm.value = true;
};

const confirmClearContext = () => {
  if (activeSession.value) {
    activeSession.value.messages = [];
  }
  showClearConfirm.value = false;
};

const cancelClearContext = () => {
  showClearConfirm.value = false;
};

// 发送消息核心逻辑（Fetch SSE 流式处理）
const sendMessage = async () => {
  if (!userInput.value.trim() || loading.value || !activeSession.value) return;

  const text = userInput.value;
  userInput.value = '';

  // 1. 追加用户消息
  const userMessage: Message = {
    id: `msg_user_${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now()
  };
  activeSession.value.messages.push(userMessage);
  nextTick(() => {
    scrollToBottom();
  });

  // 2. 初始化 AI 占位消息
  const aiMessage: Message = {
    id: `msg_ai_${Date.now()}`,
    role: 'assistant',
    content: '',
    reasoningContent: '',
    timestamp: Date.now()
  };
  activeSession.value.messages.push(aiMessage);
  loading.value = true;
  nextTick(() => {
    scrollToBottom();
  });

  // 3. 构建发送上下文消息数组
  const requestMessages = activeSession.value.messages
    .slice(0, -1) // 剔除刚刚加入的空白 AI 消息自身
    .map(m => ({
      role: m.role,
      content: m.content
    }));

  abortController.value = new AbortController();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages: requestMessages }),
      signal: abortController.value.signal
    });

    if (!response.ok) {
      throw new Error(`请求失败 (HTTP ${response.status})`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder('utf-8');

    if (!reader) {
      throw new Error('无法读取后端响应流');
    }

    let isDone = false;
    let buffer = '';

    while (!isDone && loading.value) {
      const { value, done } = await reader.read();
      isDone = done;

      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        
        // 挂起最后一个不完整的数据片断
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine.startsWith('data: ')) continue;

          const dataStr = cleanLine.slice(6).trim();
          if (dataStr === '[DONE]') {
            isDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.error) {
              throw new Error(parsed.error);
            }

            // 渐进式更新 AI 文本和思考链内容
            if (parsed.content) {
              aiMessage.content += parsed.content;
            }
            if (parsed.reasoningContent) {
              aiMessage.reasoningContent += parsed.reasoningContent;
            }
            
            // 实时滚动到最底
            scrollToBottom();
          } catch (e: any) {
            console.warn('解析 SSE 单块 JSON 失败:', e.message);
          }
        }
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('AI 生成被用户手动中断');
    } else {
      console.error('AI 对话出错:', error);
      aiMessage.content += `\n\n*[发送错误: ${error.message || '网络连接中断，请重试'}*]`;
    }
  } finally {
    loading.value = false;
    abortController.value = null;
    nextTick(() => {
      scrollToBottom();
    });
  }
};
</script>

<template>
  <div class="chat-page-container animate-fade-in">
    <!-- Left Sidebar: Session Lists -->
    <aside class="chat-sidebar card-glass">
      <div class="sidebar-header">
        <button class="btn btn-primary glow-effect-cyan w-full" @click="createNewSession">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px;">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          新建对话
        </button>
      </div>

      <div class="sessions-list scrollbar-styled">
        <div 
          v-for="session in sessions" 
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === activeSessionId }"
          @click="activeSessionId = session.id"
        >
          <div class="session-icon">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>

          <div class="session-name-wrapper">
            <input 
              v-if="editingSessionId === session.id"
              v-model="editSessionName"
              type="text"
              class="session-rename-input"
              @blur="saveSessionName(session)"
              @keyup.enter="saveSessionName(session)"
              @keyup.esc="cancelEditingSession"
              ref="renameInput"
              @click.stop
            />
            <span v-else class="session-name">{{ session.name }}</span>
          </div>

          <div class="session-actions" v-if="editingSessionId !== session.id">
            <button class="action-btn" title="重命名" @click="startEditingSession(session, $event)">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="action-btn delete" title="删除" @click="deleteSession(session.id, $event)">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>

    <!-- Right Area: Chat Window -->
    <main class="chat-main card-glass" v-if="activeSession">
      <!-- Chat Header -->
      <header class="chat-header">
        <div class="header-left">
          <h2>{{ activeSession.name }}</h2>
          <span class="message-count">{{ activeSession.messages.length }} 条对话</span>
        </div>
        <div class="header-right">
          <router-link to="/settings" class="model-indicator glow-effect">
            <span class="indicator-dot active animate-pulse"></span>
            <span class="label">当前模型:</span>
            <strong class="model-name mono-text">{{ activeModelInfo.name }}</strong>
            <svg class="chevron-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </router-link>
        </div>
      </header>

      <!-- Chat Messages List -->
      <div class="chat-messages scrollbar-styled" ref="messagesContainer">
        <!-- Empty State -->
        <div class="chat-empty-state" v-if="activeSession.messages.length === 0">
          <div class="empty-glow-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--accent-cyan)" stroke-width="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <path d="M8 10h.01M12 10h.01M16 10h.01" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <h2>开始与 AI 模型对话</h2>
          <p>
            当前激活的模型为 <code class="mono-text">{{ activeModelInfo.model || '系统环境配置' }}</code>。<br>
            发送消息后系统将依据设置 of API 地址与密钥实时调用，可在此进行灵感对谈或 prompt 调试。
          </p>
        </div>

        <!-- Messages list -->
        <div 
          v-for="(msg, index) in activeSession.messages" 
          :key="msg.id"
          class="message-row"
          :class="msg.role"
        >
          <!-- Avatar -->
          <div class="message-avatar" :class="msg.role">
            <svg v-if="msg.role === 'assistant'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="10" rx="2"/>
              <circle cx="12" cy="5" r="2"/>
              <path d="M12 7v4M8 16h8"/>
            </svg>
            <span v-else>U</span>
          </div>

          <!-- Bubble wrapper -->
          <div class="message-bubble-wrapper">
            <!-- Reasoning details if present -->
            <details 
              v-if="msg.role === 'assistant' && msg.reasoningContent" 
              class="reasoning-details"
              open
            >
              <summary class="reasoning-summary">
                <span class="reasoning-icon-spin spinner-mini" v-if="loading && index === activeSession.messages.length - 1"></span>
                <span class="reasoning-dot" v-else></span>
                思考过程 (Reasoning Process)
              </summary>
              <div class="reasoning-content mono-text">
                {{ msg.reasoningContent }}
              </div>
            </details>

            <!-- Message content -->
            <div class="message-bubble">
              <div 
                class="markdown-body" 
                v-html="formatMessageContent(msg.content)"
              ></div>
              <span 
                class="typing-cursor" 
                v-if="loading && index === activeSession.messages.length - 1 && !msg.content.endsWith(' ')"
              ></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Chat Input Area -->
      <footer class="chat-input-footer">
        <div class="input-actions-bar">
          <button 
            class="input-action-btn delete" 
            title="清空当前对话历史"
            :disabled="activeSession.messages.length === 0"
            @click="clearCurrentSessionContext"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            清除上下文
          </button>
        </div>

        <div class="input-box-wrapper">
          <textarea 
            v-model="userInput" 
            placeholder="在此输入您的问题，Shift+Enter 换行，Enter 直接发送..." 
            class="chat-textarea scrollbar-styled"
            rows="2"
            @keydown.enter.exact.prevent="sendMessage"
            :disabled="loading"
          ></textarea>

          <button 
            v-if="loading" 
            class="btn btn-outline stop-btn" 
            @click="stopGeneration"
          >
            <span class="stop-icon"></span>
            停止生成
          </button>
          <button 
            v-else 
            class="btn btn-primary send-btn glow-effect-cyan" 
            @click="sendMessage"
            :disabled="!userInput.trim()"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            发送
          </button>
        </div>
      </footer>
    </main>

    <!-- 美观的自定义删除会话确认模态弹窗 -->
    <div class="modal-backdrop" v-if="showDeleteConfirm" @click.self="cancelDeleteSession">
      <div class="confirm-dialog animate-modal">
        <div class="dialog-header">
          <div>
            <h3>删除对话确认</h3>
            <span class="mono-text">DELETE DIALOGUE SESSION</span>
          </div>
          <button type="button" class="icon-btn" @click="cancelDeleteSession" aria-label="关闭">×</button>
        </div>

        <div class="dialog-body">
          <p>您确定要永久删除对话“<strong class="highlight-text">{{ sessionToDeleteName }}</strong>”吗？此操作无法撤销，该会话下的所有历史对话消息将被永久清空。</p>
        </div>

        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" @click="cancelDeleteSession">取消</button>
          <button type="button" class="btn btn-danger glow-effect-red" @click="confirmDeleteSession">确认删除</button>
        </div>
      </div>
    </div>

    <!-- 美观的自定义清空上下文确认模态弹窗 -->
    <div class="modal-backdrop" v-if="showClearConfirm" @click.self="cancelClearContext">
      <div class="confirm-dialog animate-modal">
        <div class="dialog-header">
          <div>
            <h3>清除对话历史</h3>
            <span class="mono-text">CLEAR SESSION CONTEXT</span>
          </div>
          <button type="button" class="icon-btn" @click="cancelClearContext" aria-label="关闭">×</button>
        </div>

        <div class="dialog-body">
          <p>您确定要清除当前对话“<strong class="highlight-text">{{ activeSession?.name }}</strong>”中的所有聊天记录吗？此操作将会重置会话上下文。</p>
        </div>

        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" @click="cancelClearContext">取消</button>
          <button type="button" class="btn btn-danger glow-effect-red" @click="confirmClearContext">确认清除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-page-container {
  display: flex;
  gap: var(--space-3);
  height: calc(100vh - 96px); /* 减去顶部 header 空间和 margin */
  max-width: 1200px;
  margin: 0 auto;
}

/* Sidebar Styling */
.chat-sidebar {
  width: 260px;
  display: flex;
  flex-direction: column;
  background: rgba(20, 20, 25, 0.4);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  flex-shrink: 0;
  overflow: hidden;
}

.sidebar-header {
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-color);
}

.sessions-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  min-height: 40px;
}

.session-item:hover {
  background-color: var(--bg-panel-hover);
  color: var(--text-primary);
}

.session-item.active {
  background-color: var(--bg-panel-active);
  color: var(--text-primary);
  border-left: 2px solid var(--accent-cyan);
}

.session-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.session-item.active .session-icon {
  color: var(--accent-cyan);
}

.session-name-wrapper {
  flex: 1;
  min-width: 0;
}

.session-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.session-rename-input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--accent-cyan);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-size: 13px;
  padding: 2px 6px;
  outline: none;
}

.session-actions {
  display: none;
  gap: 4px;
  position: absolute;
  right: 8px;
  background: linear-gradient(90deg, transparent 0%, var(--bg-panel-hover) 30%);
  padding-left: 12px;
  height: 100%;
  align-items: center;
}

.session-item:hover .session-actions {
  display: inline-flex;
}

.session-item.active:hover .session-actions {
  background: linear-gradient(90deg, transparent 0%, var(--bg-panel-active) 30%);
}

.action-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  border-radius: var(--radius-xs);
  background: none;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.action-btn.delete:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

/* Chat Main Area Styling */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgba(24, 24, 27, 0.3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  overflow: hidden;
  position: relative;
}

.chat-header {
  height: 64px;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(0, 0, 0, 0.1);
}

.header-left h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.header-left .message-count {
  font-size: 11px;
  color: var(--text-muted);
}

.model-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  text-decoration: none;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.model-indicator:hover {
  border-color: var(--accent-cyan);
  background: rgba(0, 212, 170, 0.04);
}

.indicator-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}

.indicator-dot.active {
  background: var(--accent-cyan);
  box-shadow: 0 0 6px var(--accent-cyan);
}

.model-name {
  color: var(--accent-cyan);
  font-weight: 600;
}

.chevron-icon {
  color: var(--text-muted);
  transition: transform 0.2s;
}

.model-indicator:hover .chevron-icon {
  transform: translateX(2px);
  color: var(--accent-cyan);
}

/* Chat Messages */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: rgba(0, 0, 0, 0.05);
}

.chat-empty-state {
  margin: auto;
  max-width: 500px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-muted);
}

.empty-glow-icon {
  width: 80px;
  height: 80px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 212, 170, 0.05);
  border: 1px solid rgba(0, 212, 170, 0.15);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-1);
  box-shadow: inset 0 0 20px rgba(0, 212, 170, 0.05);
}

.chat-empty-state h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  background: linear-gradient(135deg, var(--text-primary) 30%, #a1a1aa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.chat-empty-state p {
  font-size: 13px;
  line-height: 1.6;
}

.chat-empty-state code {
  color: var(--accent-cyan);
  background: rgba(0, 212, 170, 0.08);
  border: 1px solid rgba(0, 212, 170, 0.15);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
}

/* Message Bubble Rows */
.message-row {
  display: flex;
  gap: 12px;
  max-width: 85%;
  align-self: flex-start;
}

.message-row.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(30, 30, 35, 0.8);
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-weight: 700;
  font-size: 12px;
  color: var(--text-primary);
}

.message-avatar.assistant {
  background: linear-gradient(135deg, rgba(0, 212, 170, 0.1) 0%, rgba(0, 255, 213, 0.02) 100%);
  border-color: rgba(0, 212, 170, 0.3);
  color: var(--accent-cyan);
  box-shadow: 0 0 10px rgba(0, 212, 170, 0.05);
}

.message-bubble-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
}

.message-bubble {
  padding: 12px 16px;
  border-radius: 4px 16px 16px 16px;
  background: rgba(28, 28, 33, 0.7);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
  position: relative;
}

.message-row.user .message-bubble {
  border-radius: 16px 4px 16px 16px;
  background: linear-gradient(135deg, rgba(0, 212, 170, 0.15) 0%, rgba(0, 100, 80, 0.25) 100%);
  border-color: rgba(0, 212, 170, 0.25);
  color: var(--text-primary);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

/* Typing indicator cursor */
.typing-cursor {
  display: inline-block;
  width: 2px;
  height: 14px;
  background: var(--accent-cyan);
  margin-left: 4px;
  vertical-align: middle;
  animation: blink 0.8s infinite;
}

@keyframes blink {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}

/* Reasoning (Thinking Process) UI Design */
.reasoning-details {
  border-radius: 8px;
  background: rgba(168, 85, 247, 0.03);
  border: 1px dashed rgba(168, 85, 247, 0.15);
  overflow: hidden;
  font-size: 12.5px;
  transition: border-color 0.2s;
  max-width: 100%;
}

.reasoning-details[open] {
  border-color: rgba(168, 85, 247, 0.25);
}

.reasoning-summary {
  padding: 8px 12px;
  font-weight: 600;
  color: #c084fc;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
  outline: none;
  background: rgba(168, 85, 247, 0.02);
}

.reasoning-summary:hover {
  background: rgba(168, 85, 247, 0.04);
}

.reasoning-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c084fc;
  box-shadow: 0 0 6px #c084fc;
}

.reasoning-icon-spin {
  width: 10px;
  height: 10px;
  border: 1.5px solid rgba(192, 132, 252, 0.2);
  border-top-color: #c084fc;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.reasoning-content {
  padding: 10px 14px;
  border-top: 1px solid rgba(168, 85, 247, 0.08);
  color: #a78bfa;
  font-style: italic;
  white-space: pre-wrap;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.15);
}

/* Markdown parsing output styling */
.markdown-body {
  word-break: break-word;
}

.markdown-body :deep(strong) {
  color: var(--text-primary);
  font-weight: 600;
}

.markdown-body :deep(code.inline-code) {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  font-size: 12.5px;
  padding: 2px 5px;
  color: #f43f5e; /* 微亮红/橙色，提升极客感 */
}

.markdown-body :deep(.code-block-wrapper) {
  margin: var(--space-2) 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25);
}

.markdown-body :deep(.code-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.markdown-body :deep(.code-lang) {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  font-weight: 600;
  font-family: var(--font-mono);
}

.markdown-body :deep(pre) {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
}

/* Input Area styling */
.chat-input-footer {
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-top: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.input-actions-bar {
  display: flex;
  gap: 8px;
}

.input-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  color: var(--text-muted);
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
  transition: all 0.2s;
}

.input-action-btn:hover:not(:disabled) {
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.04);
}

.input-action-btn.delete:hover:not(:disabled) {
  color: #f87171;
  background: rgba(239, 68, 68, 0.08);
}

.input-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.input-box-wrapper {
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
  background: rgba(20, 20, 25, 0.6);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 6px;
  position: relative;
  transition: border-color 0.2s;
}

.input-box-wrapper:focus-within {
  border-color: rgba(0, 212, 170, 0.4);
  box-shadow: 0 0 10px rgba(0, 212, 170, 0.04);
}

.chat-textarea {
  flex: 1;
  background: none;
  border: none;
  resize: none;
  outline: none;
  font-size: 13.5px;
  color: var(--text-primary);
  line-height: 1.5;
  padding: 6px 8px;
  max-height: 120px;
}

.chat-textarea::placeholder {
  color: var(--text-muted);
}

.send-btn, .stop-btn {
  flex-shrink: 0;
  margin-bottom: 2px;
  margin-right: 2px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.stop-btn {
  border-color: #ef4444;
  color: #ef4444;
}

.stop-btn:hover {
  background: rgba(239, 68, 68, 0.08);
}

.stop-icon {
  width: 10px;
  height: 10px;
  background: #ef4444;
  border-radius: 1px;
}

/* Custom Scrollbars */
.scrollbar-styled::-webkit-scrollbar {
  width: 5px;
}
.scrollbar-styled::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-styled::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-full);
}
.scrollbar-styled::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* 通用按钮系统定义（补足缺少的全局样式） */
.btn {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
  cursor: pointer;
  outline: none;
  font-family: inherit;
}

.btn-sm {
  padding: 5px 12px;
  font-size: 11px;
}

.btn-outline {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  background-color: transparent;
}

.btn-outline:hover {
  border-color: var(--border-focus);
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.02);
}

.btn-primary {
  background-color: var(--accent-cyan);
  color: var(--bg-base);
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--accent-cyan-hover);
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.w-full {
  width: 100%;
}

.glow-effect-cyan:hover:not(:disabled) {
  box-shadow: 0 0 12px rgba(0, 212, 170, 0.35);
}

/* 自定义确认弹窗样式 */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.confirm-dialog {
  background: rgba(30, 30, 35, 0.85);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  width: 100%;
  max-width: 450px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  animation: scaleUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding-bottom: var(--space-2);
}

.dialog-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.dialog-header .mono-text {
  font-size: 9px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 20px;
  cursor: pointer;
  transition: color 0.2s;
  line-height: 1;
}

.icon-btn:hover {
  color: var(--text-primary);
}

.dialog-body {
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.highlight-text {
  color: var(--text-primary);
  font-weight: 600;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: var(--space-3);
}

.btn-danger {
  background-color: #ef4444;
  color: #fff;
}

.btn-danger:hover {
  background-color: #dc2626;
  transform: translateY(-1px);
}

.glow-effect-red:hover {
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.35);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleUp {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
</style>
