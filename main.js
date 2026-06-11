// ============ 配置 ============
const OPENAI_API_URL = 'http://localhost:3001/api/generate';

// ============ 窗口管理 ============
class WindowManager {
    constructor() {
        this.container = document.getElementById('window-container');
        this.windows = [];
        this.zIndex = 100;
    }

    createWindow(appName, appTitle) {
        const id = `window-${Date.now()}`;
        const zIndex = ++this.zIndex;
        const left = 100 + this.windows.length * 30;
        const top = 80 + this.windows.length * 30;

        const windowEl = document.createElement('div');
        windowEl.className = 'window';
        windowEl.id = id;
        windowEl.style.left = `${left}px`;
        windowEl.style.top = `${top}px`;
        windowEl.style.zIndex = zIndex;

        windowEl.innerHTML = `
      <div class="window-header">
        <div class="window-controls">
          <button class="control-btn close" onclick="windowManager.closeWindow('${id}')"></button>
          <button class="control-btn minimize" onclick="windowManager.minimizeWindow('${id}')"></button>
          <button class="control-btn maximize" onclick="windowManager.maximizeWindow('${id}')"></button>
        </div>
        <span class="window-title">${appTitle}</span>
      </div>
      <div class="window-body">
        <iframe srcdoc='<div style="display:flex;justify-content:center;align-items:center;height:100%;background:#1a1a2e;color:#555;font-family:system-ui;font-size:14px;">加载中...</div>' sandbox="allow-scripts allow-same-origin allow-modals"></iframe>
      </div>
    `;

        this.container.appendChild(windowEl);
        this.windows.push({ id, appName, element: windowEl, minimized: false });

        this.makeDraggable(windowEl, windowEl.querySelector('.window-header'));

        windowEl.addEventListener('mousedown', () => {
            this.bringToFront(id);
        });

        return id;
    }

    closeWindow(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            win.element.remove();
            this.windows = this.windows.filter(w => w.id !== id);
        }
    }

    minimizeWindow(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            win.element.style.display = 'none';
            win.minimized = true;
        }
    }

    maximizeWindow(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            if (win.element.style.width === '100vw') {
                win.element.style.width = '600px';
                win.element.style.height = '400px';
                win.element.style.left = '100px';
                win.element.style.top = '80px';
                win.element.style.borderRadius = '12px';
            } else {
                win.element.style.width = '100vw';
                win.element.style.height = '100vh';
                win.element.style.left = '0';
                win.element.style.top = '0';
                win.element.style.borderRadius = '0';
            }
        }
    }

    bringToFront(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            win.element.style.zIndex = ++this.zIndex;
        }
    }

    makeDraggable(element, handle) {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('control-btn')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = element.offsetLeft;
            startTop = element.offsetTop;
            this.bringToFront(element.id);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            element.style.left = `${startLeft + dx}px`;
            element.style.top = `${startTop + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }
}

// ============ AI 应用生成器 ============
class AIGenerator {
    constructor() {
        this.cache = new Map();
        this.apiBaseUrl = OPENAI_API_URL; // 使用代理地址
    }

    async generateApp(appName, userPrompt = '') {
        const cacheKey = `${appName}_${userPrompt}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const systemPrompt = `你是一个网页应用生成器。根据用户描述的应用名称，生成一个完整的、可直接运行的HTML页面。
要求：
1. 返回纯净的HTML代码，不要用markdown包裹（不要用\`\`\`html或\`\`\`）
2. 包含完整的 <!DOCTYPE html> 结构
3. 所有CSS内联在 <style> 标签中
4. 所有JavaScript内联在 <script> 标签中
5. 页面要美观、有现代感、功能完整
6. 使用中文界面`;

        try {
            // ✅ 请求发送给自己的后端
            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    systemPrompt,
                    userPrompt: `生成一个${appName}应用`
                })
            });

            const data = await response.json();

            // ✅ 检查后端是否返回了错误
            if (data.error) {
                throw new Error(data.error);
            }

            let code = data.code; // ✅ 接收后端处理好的代码
            code = code.replace(/```html/g, '').replace(/```/g, '').trim();

            this.cache.set(cacheKey, code);
            return code;
        } catch (error) {
            console.error('AI 生成失败:', error);
            return this.getFallbackApp(appName, error.message);
        }
    }

    getFallbackApp(appName, errorMsg) {
        return `
<!DOCTYPE html>
<html>
<head><style>
body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
.error { text-align: center; padding: 40px; }
h1 { font-size: 2rem; margin-bottom: 20px; }
p { margin: 8px 0; color: #aaa; }
</style></head>
<body>
  <div class="error">
    <h1>⚠️ AI 生成失败</h1>
    <p>应用：${appName}</p>
    <p>错误：${errorMsg}</p>
    <p>请检查后端服务是否运行正常</p>
  </div>
</body>
</html>`;
    }
}

// ============ 全局实例 ============
const windowManager = new WindowManager();
const aiGenerator = new AIGenerator();

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');

    // 搜索框：回车搜索
    searchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (!query) return;

            // 立即打开一个加载中的窗口
            const windowId = windowManager.createWindow(query, `🔍 ${query}`);
            const win = windowManager.windows.find(w => w.id === windowId);
            const iframe = win.element.querySelector('iframe');

            // 显示加载动画
            iframe.srcdoc = `
                <div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a2e;color:#eee;font-family:system-ui;">
                    <div style="text-align:center">
                        <div style="width:40px;height:40px;border:4px solid #333;border-top:4px solid #7c5cfc;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
                        <div>🤖 正在启动 <strong>${query}</strong>...</div>
                        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
                    </div>
                </div>`;

            // 调用 AI 生成
            const html = await aiGenerator.generateApp(query);
            iframe.srcdoc = html;
            win.element.querySelector('.window-title').textContent = `🤖 ${query}`;
        }
    });

    // Dock 点击事件
    document.querySelectorAll('.dock-item').forEach(item => {
        item.addEventListener('click', async () => {
            const appName = item.dataset.app;
            const appTitle = item.getAttribute('title') || appName;

            const windowId = windowManager.createWindow(appName, `📦 ${appTitle}`);
            const win = windowManager.windows.find(w => w.id === windowId);
            const iframe = win.element.querySelector('iframe');

            iframe.srcdoc = `
                <div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a2e;color:#eee;font-family:system-ui;">
                    <div style="text-align:center">
                        <div style="width:40px;height:40px;border:4px solid #333;border-top:4px solid #7c5cfc;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
                        <div>🤖 正在启动 <strong>${appTitle}</strong>...</div>
                        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
                    </div>
                </div>`;

            const html = await aiGenerator.generateApp(appName);
            iframe.srcdoc = html;
            win.element.querySelector('.window-title').textContent = `🤖 ${appTitle}`;
        });
    });

    // 点击桌面空白处关闭右键菜单等
    document.getElementById('desktop').addEventListener('click', () => {
        // 可扩展
    });
});