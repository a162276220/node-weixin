const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

function list(value) {
	return String(value || '')
		.split(',')
		.map(item => item.trim())
		.filter(Boolean);
}

const sessionSecret = process.env.SESSION_SECRET || 'dev-only-secret-change-me';

if (isProd && !process.env.SESSION_SECRET) {
	throw new Error('生产环境必须设置 SESSION_SECRET 环境变量');
}

const corsOrigins = list(process.env.CORS_ORIGINS);

export default {
	env,
	isProd,
	port: Number(process.env.PORT) || 8003,
	mongoUrl: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/weixin',
	sessionName: process.env.SESSION_NAME || 'UID',
	sessionSecret,
	sessionMaxAge: Number(process.env.SESSION_MAX_AGE) || 7 * 24 * 60 * 60 * 1000,
	// 开发环境且未配置 CORS_ORIGINS 时放行全部来源，方便前端 dev server 联调
	corsOrigins,
	allowAllOrigins: !isProd && corsOrigins.length === 0,
	// 第三方问答接口（原 routes/robot.js 里硬编码的 APPCODE 已移到这里）
	robotEndpoint: process.env.ROBOT_ENDPOINT || 'http://jisuznwd.market.alicloudapi.com/iqa/query',
	robotAppCode: process.env.ROBOT_APPCODE || '',
};
