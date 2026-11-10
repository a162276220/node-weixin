import config from './config/index.js';
import bootstrap from './app.js';

bootstrap()
	.then(({ port }) => {
		console.log(`[server] 已启动 http://localhost:${port} (NODE_ENV=${config.env})`);
	})
	.catch(err => {
		console.error('[server] 启动失败:', err);
		process.exit(1);
	});
