/**
 * 窗口管理器
 * 负责创建、关闭、最小化窗口、拖动窗口，以及任务栏管理
 */
class WindowManager {
    constructor() {
        this.container = document.getElementById('window-container');
        this.taskbar = document.getElementById('dock-tasks');
        this.windows = [];
        this.zIndex = 100;
        this.activeWindowId = null;
    }

    /**
     * 加载动画模板
     */
    static loadingTemplate(title) {
        return `
            <div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a2e;color:#eee;font-family:system-ui;">
                <div style="text-align:center">
                    <div style="width:40px;height:40px;border:4px solid #333;border-top:4px solid #7c5cfc;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
                    <div>🤖 正在启动 <strong>${title}</strong>...</div>
                    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
                </div>
            </div>`;
    }

    /**
     * 查找已打开的同一应用窗口
     */
    findOpenApp(appName) {
        return this.windows.find(w => w.appName === appName);
    }

    /**
     * 创建新窗口
     */
    createWindow(appName, appTitle, icon = '📄') {
        const id = `window-${Date.now()}`;
        const zIndex = ++this.zIndex;
        const offset = this.windows.length * 30;
        const left = 100 + (offset % 300);
        const top = 80 + (offset % 200);

        const windowEl = document.createElement('div');
        windowEl.className = 'window';
        windowEl.id = id;
        windowEl.style.left = `${left}px`;
        windowEl.style.top = `${top}px`;
        windowEl.style.zIndex = zIndex;
        windowEl.style.height = 'auto'; // 高度由内容决定

        windowEl.innerHTML = `
            <div class="window-header">
                <div class="window-controls">
                    <button class="control-btn close" onclick="windowManager.closeWindow('${id}')"></button>
                    <button class="control-btn minimize" onclick="windowManager.minimizeWindow('${id}')"></button>
                </div>
                <span class="window-title">${appTitle}</span>
                <button class="fullscreen-btn" onclick="windowManager.fullscreenWindow('${id}')" title="全屏">⛶</button>
            </div>
            <div class="window-body">
                <iframe srcdoc='<div style="display:flex;justify-content:center;align-items:center;height:200px;background:#1a1a2e;color:#555;font-family:system-ui;font-size:14px;">加载中...</div>' sandbox="allow-scripts allow-same-origin"></iframe>
            </div>
        `;

        this.container.appendChild(windowEl);
        this.windows.push({ id, appName, appTitle, icon, element: windowEl, minimized: false });

        this.makeDraggable(windowEl, windowEl.querySelector('.window-header'));

        windowEl.addEventListener('mousedown', () => {
            this.bringToFront(id);
        });

        // 添加到任务栏
        this.addToTaskbar(id);

        return id;
    }

    /**
     * 自适应 iframe 内容高度
     */
    fitIframeContent(windowId) {
        const win = this.getWindow(windowId);
        if (!win) return;
        const iframe = win.element.querySelector('iframe');

        const doFit = () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                const body = doc.body;
                const html = doc.documentElement;
                const height = Math.max(body.scrollHeight, html.scrollHeight, body.offsetHeight, html.offsetHeight);

                const maxHeight = window.innerHeight - 120;
                const fitHeight = Math.min(height, maxHeight);

                iframe.style.height = fitHeight + 'px';
                const header = win.element.querySelector('.window-header');
                const windowHeight = header.offsetHeight + fitHeight + 2;
                win.element.style.height = Math.max(200, windowHeight) + 'px';
            } catch (e) { /* 跨域限制忽略 */ }
        };

        iframe.addEventListener('load', doFit);
        let retries = 0;
        const poll = setInterval(() => {
            try {
                if (iframe.contentDocument && iframe.contentDocument.body) {
                    doFit();
                    clearInterval(poll);
                }
            } catch (e) { /* ignore */ }
            if (++retries > 20) clearInterval(poll);
        }, 200);
    }

    /**
     * 关闭窗口
     */
    closeWindow(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            win.element.remove();
            this.windows = this.windows.filter(w => w.id !== id);
            this.removeFromTaskbar(id);
            // 更新前台状态
            if (this.activeWindowId === id) {
                this.activeWindowId = null;
            }
        }
    }

    /**
     * 最小化窗口
     */
    minimizeWindow(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            win.element.style.display = 'none';
            win.minimized = true;
            this.updateTaskbarState(id);
        }
    }

    /**
     * 全屏窗口（触发 iframe 原生全屏）
     */
    fullscreenWindow(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            const iframe = win.element.querySelector('iframe');
            if (iframe.requestFullscreen) {
                iframe.requestFullscreen();
            } else if (iframe.webkitRequestFullscreen) {
                iframe.webkitRequestFullscreen();
            } else if (iframe.msRequestFullscreen) {
                iframe.msRequestFullscreen();
            }
        }
    }

    /**
     * 还原窗口（从最小化恢复）
     */
    restoreWindow(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            win.element.style.display = 'flex';
            win.minimized = false;
            this.bringToFront(id);
        }
    }

    /**
     * 切换窗口状态（最小化 / 还原）
     */
    toggleWindow(id) {
        const win = this.windows.find(w => w.id === id);
        if (!win) return;
        if (win.minimized) {
            this.restoreWindow(id);
        } else if (this.activeWindowId === id) {
            this.minimizeWindow(id);
        } else {
            this.bringToFront(id);
        }
    }

    /**
     * 将窗口置顶
     */
    bringToFront(id) {
        const win = this.windows.find(w => w.id === id);
        if (win) {
            win.element.style.zIndex = ++this.zIndex;
            if (win.minimized) {
                win.element.style.display = 'flex';
                win.minimized = false;
            }
            this.activeWindowId = id;
            this.updateTaskbarState(id);
        }
    }

    /**
     * 根据 id 获取窗口对象
     */
    getWindow(id) {
        return this.windows.find(w => w.id === id);
    }

    /**
     * 根据 iframe 的 contentWindow 查找窗口 ID
     */
    findWindowByIframeSource(source) {
        for (const win of this.windows) {
            const iframe = win.element.querySelector('iframe');
            if (iframe && iframe.contentWindow === source) {
                return win.id;
            }
        }
        return null;
    }

    /**
     * 显示加载覆盖层（旋转图标 + 禁止 iframe 点击）
     */
    showLoadingOverlay(windowId) {
        const win = this.getWindow(windowId);
        if (!win) return;
        const body = win.element.querySelector('.window-body');
        if (body.querySelector('.window-loading-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'window-loading-overlay';
        overlay.innerHTML = '<div class="loading-spinner"></div>';
        body.appendChild(overlay);
        const iframe = body.querySelector('iframe');
        if (iframe) iframe.style.pointerEvents = 'none';
    }

    /**
     * 隐藏加载覆盖层
     */
    hideLoadingOverlay(windowId) {
        const win = this.getWindow(windowId);
        if (!win) return;
        const overlay = win.element.querySelector('.window-loading-overlay');
        if (overlay) overlay.remove();
        const iframe = win.element.querySelector('iframe');
        if (iframe) iframe.style.pointerEvents = '';
    }

    // ============ 任务栏管理 ============

    /**
     * 添加应用到任务栏
     */
    addToTaskbar(windowId) {
        const win = this.getWindow(windowId);
        if (!win) return;

        // 避免重复添加
        if (document.getElementById(`task-${windowId}`)) return;

        const taskEl = document.createElement('div');
        taskEl.className = 'dock-item task-item';
        taskEl.id = `task-${windowId}`;
        taskEl.dataset.windowId = windowId;
        taskEl.setAttribute('title', win.appTitle);
        taskEl.innerHTML = `<span>${win.icon}</span>`;

        taskEl.addEventListener('click', () => {
            this.toggleWindow(windowId);
        });

        this.taskbar.appendChild(taskEl);
        this.updateTaskbarState(windowId);
    }

    /**
     * 从任务栏移除应用
     */
    removeFromTaskbar(windowId) {
        const taskEl = document.getElementById(`task-${windowId}`);
        if (taskEl) taskEl.remove();
    }

    /**
     * 更新任务栏状态（激活/非激活指示点）
     */
    updateTaskbarState(windowId) {
        // 清除所有任务项的高亮
        this.taskbar.querySelectorAll('.task-item').forEach(el => {
            el.classList.remove('active');
        });

        const win = this.getWindow(windowId);
        if (!win) return;

        const taskEl = document.getElementById(`task-${windowId}`);
        if (taskEl && !win.minimized && this.activeWindowId === windowId) {
            taskEl.classList.add('active');
        }
    }

    // ============ 拖拽 ============

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
