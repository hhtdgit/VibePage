/**
 * VibePage 应用入口
 * 初始化窗口管理器、AI 生成器，绑定搜索和任务栏交互，处理 AI 重新渲染
 */

// ============ 全局实例 ============
const windowManager = new WindowManager();
const aiGenerator = new AIGenerator();

// ============ 渲染队列（最多 3 个并发） ============
const MAX_CONCURRENT = 3;
let _activeCount = 0;
const _pendingQueue = [];

function _dequeue() {
    if (_pendingQueue.length > 0 && _activeCount < MAX_CONCURRENT) {
        const next = _pendingQueue.shift();
        next();
    }
}

function enqueue(fn) {
    return new Promise((resolve, reject) => {
        const task = async () => {
            _activeCount++;
            try {
                resolve(await fn());
            } catch (e) {
                reject(e);
            } finally {
                _activeCount--;
                _dequeue();
            }
        };
        if (_activeCount < MAX_CONCURRENT) {
            task();
        } else {
            _pendingQueue.push(task);
        }
    });
}

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
 * 创建流式渲染处理器（每 1 秒刷新，保留滚动位置）
 */
function createStreamHandler(iframe) {
    let timer = null;
    let lastUpdate = 0;
    const THROTTLE_MS = 1000;

    let scrollPercent = 0;
    let scrollLeft = 0;

    function saveScroll() {
        try {
            const d = iframe.contentDocument || iframe.contentWindow.document;
            const sh = d.documentElement.scrollHeight || d.body.scrollHeight || 1;
            scrollPercent = (d.documentElement.scrollTop || d.body.scrollTop || 0) / sh;
            scrollLeft = d.documentElement.scrollLeft || d.body.scrollLeft || 0;
        } catch (e) { scrollPercent = 0; scrollLeft = 0; }
    }

    function restoreScroll() {
        try {
            const d = iframe.contentDocument || iframe.contentWindow.document;
            const sh = d.documentElement.scrollHeight || d.body.scrollHeight || 1;
            const top = scrollPercent * sh;
            d.documentElement.scrollTop = top;
            d.body.scrollTop = top;
            d.documentElement.scrollLeft = scrollLeft;
            d.body.scrollLeft = scrollLeft;
        } catch (e) { /* 跨域或未加载 */ }
    }

    let pendingLoad = null;

    return (html) => {
        const now = Date.now();

        const doUpdate = () => {
            saveScroll();
            iframe.srcdoc = html;
            if (pendingLoad) iframe.removeEventListener('load', pendingLoad);
            pendingLoad = () => { restoreScroll(); pendingLoad = null; };
            iframe.addEventListener('load', pendingLoad, { once: true });
            lastUpdate = now;
        };

        if (now - lastUpdate > THROTTLE_MS) {
            doUpdate();
            if (timer) { clearTimeout(timer); timer = null; }
        } else {
            if (timer) clearTimeout(timer);
            timer = setTimeout(doUpdate, THROTTLE_MS);
        }
    };
}

/**
 * 打开应用（已打开的则置前，否则新建）
 * 一次渲染：加载中提示 → 完整内容就绪后一次性显示
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

    // 加入渲染队列（最多 3 个并发）
    const html = await enqueue(() =>
        aiGenerator.generateApp(appName, '', createStreamHandler(iframe))
    );
    showAppInWindow(win, `🤖 ${appTitle}`, html);

    // 生成完成后自动保存快照
    try { localStorage.setItem(`vibepage_snapshot_${appName}`, html); } catch (e) { console.warn('快照保存失败:', e); }

    windowManager.hideHeaderSpinner(windowId);

    // 内容加载后自适应高度
    windowManager.fitIframeContent(windowId);
}

/**
 * AI 重新渲染窗口内容（标题栏转圈 + 流式更新，保留滚动位置）
 */
async function reRenderApp(windowId, prompt, context) {
    const win = windowManager.getWindow(windowId);
    if (!win) return;

    const iframe = win.element.querySelector('iframe');

    // 标题栏加载指示 + 加入渲染队列
    windowManager.showHeaderSpinner(windowId);

    const html = await enqueue(() =>
        aiGenerator.regenerateApp(win.appName, prompt, context, createStreamHandler(iframe))
    );

    if (iframe) {
        iframe.srcdoc = html;
        win.element.querySelector('.window-title').textContent = `🤖 ${win.appTitle}`;
        // 重新渲染后自动更新快照
        try { localStorage.setItem(`vibepage_snapshot_${win.appName}`, html); } catch (e) { console.warn('快照保存失败:', e); }
    }

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

    // 全屏切换（按钮 + F11）
    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    }
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);

    // 导入应用
    const importBtn = document.getElementById('import-btn');
    const importInput = document.getElementById('import-file-input');
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const html = await file.text();
        let appName = file.name.replace(/\.html$/i, '');

        // 重名检测
        const existingWin = windowManager.findOpenApp(appName);
        const hasSnapshot = WindowManager.loadSnapshot(appName);
        if (existingWin || hasSnapshot) {
            const msg = `"${appName}" 已存在。\n确定覆盖吗？\n\n点「取消」可换个应用名导入。`;
            if (!confirm(msg)) {
                const newName = prompt(`请输入新的应用名：`, `${appName}-导入`);
                if (!newName) { importInput.value = ''; return; }
                appName = newName;
            }
        }

        // 复用已有窗口或新建
        let win;
        const reuse = windowManager.findOpenApp(appName);
        if (reuse) {
            win = reuse;
            win.element.querySelector('iframe').srcdoc = html;
            win.element.querySelector('.window-title').textContent = `📂 ${appName}`;
            windowManager.bringToFront(reuse.id);
        } else {
            const windowId = windowManager.createWindow(appName, `📂 ${appName}`);
            win = windowManager.getWindow(windowId);
            win.element.querySelector('iframe').srcdoc = html;
            win.element.querySelector('.window-title').textContent = `📂 ${appName}`;
        }
        windowManager.fitIframeContent(win.id);
        try { localStorage.setItem(`vibepage_snapshot_${appName}`, html); } catch (e) { console.warn('快照保存失败:', e); }
        importInput.value = '';
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            toggleFullscreen();
        }
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
