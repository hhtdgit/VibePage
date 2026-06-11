/**
 * VibePage 应用入口
 * 初始化窗口管理器、AI 生成器，绑定搜索和任务栏交互，处理 AI 重新渲染
 */

// ============ 全局实例 ============
const windowManager = new WindowManager();
const aiGenerator = new AIGenerator();

// ============ UI 辅助 ============
function showLoadingInWindow(win, title) {
    const iframe = win.element.querySelector('iframe');
    iframe.srcdoc = WindowManager.loadingTemplate(title);
}

function showAppInWindow(win, title, html) {
    const iframe = win.element.querySelector('iframe');
    iframe.srcdoc = html;
    win.element.querySelector('.window-title').textContent = title;
}

/**
 * 创建流式渲染处理器（每1秒更新一次 iframe，避免频闪）
 */
function createStreamHandler(iframe) {
    let timer = null;
    let lastUpdate = 0;
    const THROTTLE_MS = 1000;

    return (html) => {
        const now = Date.now();
        if (now - lastUpdate > THROTTLE_MS) {
            iframe.srcdoc = html;
            lastUpdate = now;
            if (timer) { clearTimeout(timer); timer = null; }
        } else {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                iframe.srcdoc = html;
                lastUpdate = Date.now();
                timer = null;
            }, THROTTLE_MS);
        }
    };
}

/**
 * 打开应用（已打开的则置前，否则新建）
 * 采用"骨架优先"策略：先快速生成布局骨架，再生成完整版替换
 * @param {string} appName - 应用标识
 * @param {string} appTitle - 显示标题
 * @param {string} icon - 显示的图标 emoji
 */
async function openApp(appName, appTitle, icon = '📄') {
    // 检查是否已打开
    const existing = windowManager.findOpenApp(appName);
    if (existing) {
        windowManager.bringToFront(existing.id);
        return;
    }

    // 新建窗口
    const windowId = windowManager.createWindow(appName, appTitle, icon);
    const win = windowManager.getWindow(windowId);
    const iframe = win.element.querySelector('iframe');

    showLoadingInWindow(win, appTitle);
    windowManager.showHeaderSpinner(windowId);

    // 第 1 步：快速骨架（流式渲染到 iframe）
    aiGenerator.onChunk = createStreamHandler(iframe);
    await aiGenerator.generatePreview(appName);

    // 第 2 步：完整版（流式替换骨架）
    aiGenerator.onChunk = createStreamHandler(iframe);
    const html = await aiGenerator.generateApp(appName);
    showAppInWindow(win, `🤖 ${appTitle}`, html);

    aiGenerator.onChunk = null;
    windowManager.hideHeaderSpinner(windowId);

    // 内容加载后自适应高度
    windowManager.fitIframeContent(windowId);
}

/**
 * AI 重新渲染窗口内容（标题栏转圈 + 流式更新，不阻塞 iframe）
 */
async function reRenderApp(windowId, prompt, context) {
    const win = windowManager.getWindow(windowId);
    if (!win) return;

    const iframe = win.element.querySelector('iframe');

    // 标题栏转圈 + 流式渐进渲染（不阻塞 iframe 交互）
    windowManager.showHeaderSpinner(windowId);
    aiGenerator.onChunk = createStreamHandler(iframe);

    const html = await aiGenerator.regenerateApp(win.appName, prompt, context);

    if (iframe) {
        iframe.srcdoc = html;
        win.element.querySelector('.window-title').textContent = `🤖 ${win.appTitle}`;
    }

    aiGenerator.onChunk = null;
    windowManager.hideHeaderSpinner(windowId);
    windowManager.fitIframeContent(windowId);
    windowManager.bringToFront(windowId);
}

// ============ 监听 iframe 发来的 AI 请求 ============
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'ai-request') {
        const { prompt, context } = e.data;
        const windowId = windowManager.findWindowByIframeSource(e.source);
        if (windowId && prompt) {
            reRenderApp(windowId, prompt, context || '');
        }
    }
});

// ============ 搜索建议 ============
let suggestTimer = null;
let suggestQueryCache = '';
let suggestSeq = 0;

function showSuggestions(items) {
    const el = document.getElementById('suggestions');
    if (!items || items.length === 0) {
        el.style.display = 'none';
        return;
    }
    el.innerHTML = items.map(item =>
        `<div class="suggest-item" data-text="${item.replace(/"/g, '&quot;')}">${item}</div>`
    ).join('');
    el.style.display = 'block';
}

function hideSuggestions() {
    const el = document.getElementById('suggestions');
    el.style.display = 'none';
    el.innerHTML = ''; // 清空内容，避免频闪
}

async function fetchSuggestions(query) {
    if (query === suggestQueryCache) return;
    suggestQueryCache = query;
    const seq = ++suggestSeq;
    try {
        const res = await fetch('/api/suggest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await res.json();
        // 丢弃过期请求的结果
        if (seq !== suggestSeq) return;
        // 输入框已无文字，不展示
        if (!document.getElementById('searchInput').value.trim()) {
            hideSuggestions();
            return;
        }
        if (data.suggestions && data.suggestions.length) {
            showSuggestions(data.suggestions);
        } else {
            hideSuggestions();
        }
    } catch (e) {
        hideSuggestions();
    }
}

function clearSuggestTimer() {
    if (suggestTimer) {
        clearInterval(suggestTimer);
        suggestTimer = null;
    }
}

// ============ DOM 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const suggestionsEl = document.getElementById('suggestions');

    // 输入时：启动 1 秒轮询
    searchInput.addEventListener('input', () => {
        clearSuggestTimer();
        const query = searchInput.value.trim();
        if (query.length < 2) {
            hideSuggestions();
            return;
        }
        suggestTimer = setInterval(() => {
            const q = searchInput.value.trim();
            if (q.length >= 2 && q !== suggestQueryCache) fetchSuggestions(q);
        }, 500);
        // 立即请求一次
        fetchSuggestions(query);
    });

    // 回车：打开应用 + 隐藏建议
    searchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (!query) return;
            clearSuggestTimer();
            hideSuggestions();
            searchInput.value = '';
            await openApp(query, query, '🔍');
        }
        if (e.key === 'Escape') {
            clearSuggestTimer();
            hideSuggestions();
        }
    });

    // 失焦关闭建议
    searchInput.addEventListener('blur', () => {
        setTimeout(hideSuggestions, 200);
    });
    searchInput.addEventListener('focus', () => {
        const q = searchInput.value.trim();
        if (q.length >= 2) fetchSuggestions(q);
    });

    // 建议项点击：使用委托监听
    suggestionsEl.addEventListener('click', (e) => {
        const item = e.target.closest('.suggest-item');
        if (!item) return;
        const text = item.dataset.text;
        clearSuggestTimer();
        hideSuggestions();
        searchInput.value = '';
        openApp(text, text, '🔍');
    });

    // Dock 启动器点击触发
    document.querySelectorAll('.dock-launcher').forEach(item => {
        item.addEventListener('click', async () => {
            const appName = item.dataset.app;
            const appTitle = item.getAttribute('title') || appName;
            const icon = item.querySelector('span').textContent;
            await openApp(appName, appTitle, icon);
        });
    });
});
