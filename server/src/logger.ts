import pino from 'pino';
import pinoHttp from 'pino-http';

const level = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export const httpLogger = (pinoHttp as any)({
  logger,
  genReqId: (req: any) => req.id || undefined,
  serializers: {
    req(req: any) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
      };
    },
    res(res: any) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});
