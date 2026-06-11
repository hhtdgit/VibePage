/**
 * AI 应用生成器
 * 通过后端代理调用 DeepSeek API，生成 HTML 网页应用（流式 SSE）
 */
class AIGenerator {
    constructor(apiBaseUrl = '/api/generate') {
        this.cache = new Map();
        this.apiBaseUrl = apiBaseUrl;
    }

    /**
     * 构建生成请求体
     */
    _buildPayload(systemPrompt, userPrompt) {
        return {
            systemPrompt,
            userPrompt
        };
    }

    /**
     * 通用 SSE 流式请求
     * @param {function} onChunk - 每收到一个 token 块的回调(partialHtml)
     * @returns {Promise<string>} 完整的 HTML
     */
    async _streamRequest(systemPrompt, userPrompt, onChunk = null) {
        const response = await fetch(this.apiBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this._buildPayload(systemPrompt, userPrompt))
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'API Error');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6).trim());
                    if (data.error) throw new Error(data.error);
                    if (data.done) {
                        fullContent = data.full;
                        break;
                    }
                    if (data.full) {
                        fullContent = data.full;
                        const cleaned = this._cleanCode(data.full);
                        if (onChunk) onChunk(cleaned);
                    }
                }
            }
        }

        return this._cleanCode(fullContent);
    }

    /**
     * 清理 markdown 包裹
     */
    _cleanCode(code) {
        return code.replace(/```html/g, '').replace(/```/g, '').trim();
    }

    /**
     * 构建系统提示词
     */
    _buildSystemPrompt() {
        return `你是一个HTML代码生成器。只输出纯HTML代码，不输出任何解释、说明或对话文字。

## 界面结构建议
大体上可以分为两个区域：
- **用户输入区**：用户可填写信息的区域（输入框、文本域、表单等）
- **交互区**：按钮、滑动条、可点击且响应的互动元素
1. 返回纯净的HTML代码，不要用markdown包裹
2. 包含完整的 <!DOCTYPE html> 结构
3. 所有CSS内联在 <style> 标签中
4. 所有JavaScript内联在 <script> 标签中
5. 页面要美观、有现代感（使用渐变色、圆角、毛玻璃效果等）
6. 使用中文界面
7. 不要给 body 或 html 设置 height: 100% 或 100vh，让高度由内容自然撑开
8. 内容区域使用 padding 留白，不要使用 position:fixed 固定元素在底部
9. 不要添加关闭按钮、最小化按钮、窗口边框或标题栏，这些由父窗口提供
10. CSS 保持简洁精炼，避免重复声明，总代码量控制在 300 行以内

## 三种交互模式 —— 你必须根据功能自行判断使用哪种

### 模式一：纯前端交互（写死逻辑）
当交互要求实时响应、不需要AI参与时，直接用JavaScript处理：
- 小游戏的物理引擎、计分、碰撞检测
- 音乐播放器的拖动滚动条改变播放进度
- 打字测速的实时统计
- 表单输入验证
- 计算器、时钟、倒计时等
直接用JS写死在页面中，不需要调用父窗口。

### 模式二：键盘交互（回车触发）
用户通过键盘直接操作的功能：
- 终端（按回车发送命令）→ 按回车后用 postMessage 发送 AI 请求
- 浏览器搜索框按回车 → 用 postMessage 发送搜索关键词
- 聊天输入框按回车发送消息 → 用 postMessage 发送消息内容
用法：在输入框监听 keydown/keypress 事件，检测 Enter 键后调 postMessage

### 模式三：AI重新渲染（通过 postMessage 通知父窗口）
当交互需要切换上下文、加载新内容时，使用 postMessage 通知父窗口重新生成：
- 音乐播放器切歌/下一首 → postMessage
- 浏览器搜索用户输入的关键词 → postMessage（回车搜索也走此模式）
- 点击搜索结果 → postMessage
- 终端发送命令后的输出 → postMessage
- 任何需要AI理解用户意图才能继续的场景

用法：
<button onclick="window.parent.postMessage({type:'ai-request', prompt:'用户的具体请求', context:'当前页面描述'},'*')">下一首</button>

## 关键规则
- 仔细判断每个交互应该使用模式一、模式二还是模式三
- **所有按钮和交互元素必须可响应**：要么写死 JS 逻辑（模式一），要么通过回车/点击触发 postMessage（模式二/三），绝对不能有无效/无响应的按钮`;
    }

    /**
     * 生成应用的 HTML 代码（流式）
     * @param {string} appName - 应用名称
     * @param {string} userPrompt - 额外提示词
     * @param {function} onChunk - 每收到 token 块的回调(partialHtml)，独立于其他请求
     * @returns {Promise<string>} 完整的 HTML 字符串
     */
    async generateApp(appName, userPrompt = '', onChunk = null) {
        const cacheKey = `${appName}_${userPrompt}`;
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (onChunk) onChunk(cached);
            return cached;
        }

        const systemPrompt = this._buildSystemPrompt();

        try {
            let code = await this._streamRequest(
                systemPrompt,
                `生成一个可直接运行的"${appName}"网页，仅返回HTML代码`,
                onChunk
            );

            // 检测截断
            if (!code.toLowerCase().includes('</html>')) {
                code = this.getTruncatedApp(appName);
                if (onChunk) onChunk(code);
                return code;
            }

            this.cache.set(cacheKey, code);
            if (onChunk) onChunk(code);
            return code;
        } catch (error) {
            console.error('AI 生成失败:', error);
            const fallback = this.getFallbackApp(appName, error.message);
            if (onChunk) onChunk(fallback);
            return fallback;
        }
    }

    /**
     * 重新生成应用（带上下文，不使用缓存，流式）
     * @param {string} appName - 应用名称
     * @param {string} userPrompt - 用户的具体请求
     * @param {string} context - 当前页面上下文描述
     * @param {function} onChunk - 每收到 token 块的回调(partialHtml)，独立于其他请求
     * @returns {Promise<string>}
     */
    async regenerateApp(appName, userPrompt = '', context = '', onChunk = null) {
        const contextPrompt = context ? `\n当前页面状态：${context}` : '';
        const fullPrompt = `继续之前生成的"${appName}"应用。${userPrompt}${contextPrompt}\n直接输出完整的HTML页面。`;

        try {
            let code = await this._streamRequest(this._buildSystemPrompt(), fullPrompt, onChunk);

            // 检测截断
            if (!code.toLowerCase().includes('</html>')) {
                code = this.getTruncatedApp(appName);
                if (onChunk) onChunk(code);
                return code;
            }

            if (onChunk) onChunk(code);
            return code;
        } catch (error) {
            console.error('AI 重新生成失败:', error);
            const fallback = this.getFallbackApp(appName, error.message);
            if (onChunk) onChunk(fallback);
            return fallback;
        }
    }

    /**
     * 生成失败时的兜底页面
     */
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

    /**
     * HTML 被截断时的错误页面
     */
    getTruncatedApp(appName) {
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
    <h1>📦 应用太大无法打开</h1>
    <p>"${appName}" 生成的页面超出了大小限制</p>
    <p>请尝试简化应用或换个更小的应用</p>
  </div>
</body>
</html>`;
    }
}
