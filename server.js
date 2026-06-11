/**
 * VibePage 服务器 — 零依赖，纯 Node.js 内置模块
 * 用法：node server.js
 */
// 抑制 Node 20 的 Fetch API 实验性警告
process.on('warning', w => { if (w.name === 'ExperimentalWarning') return; console.warn(w); });

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { exec, execSync } = require('child_process');

const PORT = 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_EXE = !!process.pkg;

// 端口冲突检测（仅 EXE 模式）
function checkPortInUse(port) {
    return new Promise((resolve) => {
        const tester = net.createServer();
        tester.once('error', () => resolve(true));
        tester.once('listening', () => { tester.close(); resolve(false); });
        tester.listen(port);
    });
}

(async () => {
    if (IS_EXE) {
        const inUse = await checkPortInUse(PORT);
        if (inUse) {
            try {
                execSync(`powershell -NoProfile -Command "[System.Windows.Forms.MessageBox]::Show('端口 ${PORT} 已占用，请勿重复启动。', 'VibePage')"`, { stdio: 'ignore', timeout: 15000 });
            } catch (e) {
                try {
                    execSync(`mshta "javascript:new ActiveXObject('WScript.Shell').Popup('端口 ${PORT} 已占用，请勿重复启动。',0,'VibePage',0);close()"`, { stdio: 'ignore', timeout: 15000 });
                } catch (e2) { }
            }
            process.exit(1);
            return;
        }
    }

    // 读取配置
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    const { key: API_KEY, base_url: API_URL, model: MODEL } = config;

    // MIME 映射
    const MIME = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
    };

    // 静态文件服务
    function serveStatic(req, res) {
        let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
        const ext = path.extname(filePath);

        // URL decode
        try { filePath = decodeURIComponent(filePath); } catch (e) { /* ignore */ }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                // 文件不存在 ⇒ 返回 index.html（SPA 友好）
                fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexData) => {
                    if (err2) {
                        res.writeHead(500);
                        res.end('500 Internal Server Error');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(indexData);
                });
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            res.end(data);
        });
    }

    // 处理 API 请求（流式 SSE）
    async function handleAPI(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { systemPrompt, userPrompt, preview } = JSON.parse(body);

                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    body: JSON.stringify({
                        model: MODEL,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        temperature: 0.7,
                        max_tokens: preview ? 800 : 20000,
                        stream: true
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error?.message || 'DeepSeek API Error');
                }

                // SSE 响应头
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });

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
                            const dataStr = line.slice(6).trim();
                            if (dataStr === '[DONE]') continue;
                            try {
                                const chunk = JSON.parse(dataStr);
                                const delta = chunk.choices?.[0]?.delta?.content || '';
                                if (delta) {
                                    fullContent += delta;
                                    res.write(`data: ${JSON.stringify({ content: delta, full: fullContent })}\n\n`);
                                }
                            } catch (e) { /* 跳过解析错误 */ }
                        }
                    }
                }

                // 发送完成信号
                res.write(`data: ${JSON.stringify({ done: true, full: fullContent })}\n\n`);
                res.end();
            } catch (error) {
                console.error('API Error:', error);
                res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
                res.end();
            }
        });
    }

    // 处理搜索建议请求
    async function handleSuggest(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { query } = JSON.parse(body);
                if (!query || query.length < 2) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ suggestions: [] }));
                    return;
                }

                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    body: JSON.stringify({
                        model: MODEL,
                        messages: [
                            { role: 'system', content: '你是应用商店搜索助手。根据用户输入，返回 5 个相关的应用名称（如计算器、笔记、音乐播放器等应用程序，不是网页）。用 JSON 数组格式返回，只返回数组，不要多余文字。例如：["计算器", "音乐播放器", "记事本", "浏览器", "终端"]' },
                            { role: 'user', content: query }
                        ],
                        temperature: 0.7,
                        max_tokens: 200
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || 'API Error');

                let suggestions;
                try {
                    suggestions = JSON.parse(data.choices[0].message.content);
                } catch (e) {
                    suggestions = [];
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ suggestions }));
            } catch (error) {
                console.error('Suggest Error:', error);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ suggestions: [] }));
            }
        });
    }

    // 创建服务器
    const server = http.createServer((req, res) => {
        // CORS 头（允许浏览器跨域请求）
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // 预检请求直接返回
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // 路由分发
        if (req.method === 'POST' && req.url === '/api/generate') {
            handleAPI(req, res);
        } else if (req.method === 'POST' && req.url === '/api/suggest') {
            handleSuggest(req, res);
        } else {
            serveStatic(req, res);
        }
    });

    server.listen(PORT, () => {
        console.log(`🚀 VibePage 已启动: http://localhost:${PORT}`);
        console.log(`📦 零依赖 | 模型: ${MODEL} | 无需 npm install`);

        // 自动打开浏览器
        const startCmd = process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${startCmd} http://localhost:${PORT}`);
    });
})();
