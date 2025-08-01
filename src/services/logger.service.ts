import { Injectable, LoggerService as NestLoggerService } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import pino from "pino";
import { IncomingMessage } from "http";

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: pino.Logger;

  constructor(private readonly configService: ConfigService) {
    const logLevel = this.configService.get<string>("LOG_LEVEL", "info");
    const isDevelopment =
      this.configService.get<string>("NODE_ENV") === "development";

    this.logger = pino({
      level: logLevel,
      ...(isDevelopment && {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "yyyy-mm-dd HH:MM:ss",
          },
        },
      }),
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      base: {
        pid: process.pid,
        hostname: process.env.HOSTNAME || "localhost",
        service: this.configService.get<string>(
          "APP_NAME",
          "url-shortener-boost"
        ),
        version: process.env.npm_package_version || "1.0.0",
        environment: this.configService.get<string>("NODE_ENV", "development"),
      },
    });
  }

  /**
   * Log an informational message
   */
  log(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.info(
      {
        context,
        ...meta,
      },
      message
    );
  }

  /**
   * Log an error message
   */
  error(
    message: string,
    trace?: string,
    context?: string,
    meta?: Record<string, any>
  ): void {
    this.logger.error(
      {
        context,
        trace,
        ...meta,
      },
      message
    );
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.warn(
      {
        context,
        ...meta,
      },
      message
    );
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.debug(
      {
        context,
        ...meta,
      },
      message
    );
  }

  /**
   * Log a verbose message
   */
  verbose(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.trace(
      {
        context,
        ...meta,
      },
      message
    );
  }

  /**
   * Log HTTP request information
   */
  logRequest(req: IncomingMessage, requestId: string, startTime: number): void {
    const duration = Date.now() - startTime;

    this.logger.info(
      {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.headers["user-agent"],
        ip: this.getClientIp(req),
        duration,
        type: "http_request",
      },
      `${req.method} ${req.url}`
    );
  }

  /**
   * Log HTTP response information
   */
  logResponse(
    req: IncomingMessage,
    statusCode: number,
    requestId: string,
    startTime: number,
    meta?: Record<string, any>
  ): void {
    const duration = Date.now() - startTime;

    this.logger.info(
      {
        requestId,
        method: req.method,
        url: req.url,
        statusCode,
        duration,
        type: "http_response",
        ...meta,
      },
      `${req.method} ${req.url} ${statusCode} - ${duration}ms`
    );
  }

  /**
   * Log database query information
   */
  logQuery(
    query: string,
    parameters: any[],
    duration: number,
    requestId?: string
  ): void {
    this.logger.debug(
      {
        requestId,
        query,
        parameters,
        duration,
        type: "database_query",
      },
      `Database query executed in ${duration}ms`
    );
  }

  /**
   * Log cache operation
   */
  logCache(
    operation: string,
    key: string,
    hit: boolean,
    duration: number,
    requestId?: string
  ): void {
    this.logger.debug(
      {
        requestId,
        operation,
        key,
        hit,
        duration,
        type: "cache_operation",
      },
      `Cache ${operation} ${hit ? "HIT" : "MISS"} for key: ${key}`
    );
  }

  /**
   * Log metrics
   */
  logMetric(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    this.logger.info(
      {
        metric: name,
        value,
        labels,
        type: "metric",
        timestamp: new Date().toISOString(),
      },
      `Metric: ${name} = ${value}`
    );
  }

  /**
   * Log security events
   */
  logSecurity(
    event: string,
    details: Record<string, any>,
    severity: "low" | "medium" | "high" = "medium"
  ): void {
    this.logger.warn(
      {
        event,
        severity,
        type: "security",
        ...details,
      },
      `Security event: ${event}`
    );
  }

  /**
   * Log business events
   */
  logBusiness(event: string, details: Record<string, any>): void {
    this.logger.info(
      {
        event,
        type: "business",
        ...details,
      },
      `Business event: ${event}`
    );
  }

  /**
   * Create a child logger with additional context
   */
  child(bindings: Record<string, any>): LoggerService {
    const childLogger = new LoggerService(this.configService);
    (childLogger as any).logger = this.logger.child(bindings);
    return childLogger;
  }

  /**
   * Get raw pino logger instance
   */
  getRawLogger(): pino.Logger {
    return this.logger;
  }

  /**
   * Extract client IP from request
   */
  private getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"] as string;
    const realIp = req.headers["x-real-ip"] as string;
    const clientIp = req.headers["x-client-ip"] as string;

    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }

    return realIp || clientIp || req.socket?.remoteAddress || "unknown";
  }
}
