import { describe, it, expect, beforeEach } from "vitest";
import type { Request, Response } from "express";
import {
  corsMiddleware,
  securityHeadersMiddleware,
  rateLimitMiddleware,
  sanitizationMiddleware,
} from "./security.middleware";

// Mock Request ve Response
function createMockRequest(overrides = {}): Partial<Request> {
  return {
    headers: {},
    method: "GET",
    path: "/api/test",
    ip: "127.0.0.1",
    connection: { remoteAddress: "127.0.0.1" } as any,
    query: {},
    body: {},
    ...overrides,
  };
}

function createMockResponse(): Partial<Response> {
  const headers: Record<string, string> = {};
  return {
    header: (key: string, value: string) => {
      headers[key] = value;
      return headers;
    },
    getHeaders: () => headers,
    sendStatus: (code: number) => ({ status: code }),
    status: (code: number) => ({
      json: (data: any) => ({ status: code, data }),
    }),
    on: (event: string, callback: Function) => {
      if (event === "finish") {
        callback();
      }
    },
  };
}

describe("Security Middleware", () => {
  describe("CORS Middleware", () => {
    it("should allow Chrome extension origins", () => {
      const req = createMockRequest({
        headers: { origin: "chrome-extension://abc123" },
        method: "GET",
      }) as Request;

      const res = createMockResponse() as Response;
      let nextCalled = false;

      corsMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("should allow Firefox extension origins", () => {
      const req = createMockRequest({
        headers: { origin: "moz-extension://xyz789" },
        method: "GET",
      }) as Request;

      const res = createMockResponse() as Response;
      let nextCalled = false;

      corsMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("should respond to OPTIONS requests", () => {
      const req = createMockRequest({
        headers: { origin: "chrome-extension://abc" },
        method: "OPTIONS",
      }) as Request;

      const res = createMockResponse() as Response;
      let statusCode = 0;

      res.sendStatus = (code: number) => {
        statusCode = code;
        return {};
      };

      corsMiddleware(req, res, () => {});

      expect(statusCode).toBe(200);
    });
  });

  describe("Security Headers Middleware", () => {
    it("should add security headers", () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const headers: Record<string, string> = {};

      res.header = (key: string, value: string) => {
        headers[key] = value;
        return headers;
      };

      securityHeadersMiddleware(req, res, () => {});

      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["X-XSS-Protection"]).toBe("1; mode=block");
      expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
      expect(headers["Content-Security-Policy"]).toBeDefined();
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["Permissions-Policy"]).toBeDefined();
    });
  });

  describe("Rate Limit Middleware", () => {
    it("should allow requests under limit", () => {
      const middleware = rateLimitMiddleware(10, 60000);
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      let nextCalled = false;

      res.status = (code: number) => {
        expect(code).not.toBe(429);
        return { json: () => {} };
      };

      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("should reject requests over limit", () => {
      const middleware = rateLimitMiddleware(2, 60000);
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      let statusCode = 0;

      res.status = (code: number) => {
        statusCode = code;
        return { json: () => {} };
      };

      // Simulate 3 requests
      middleware(req, res, () => {});
      middleware(req, res, () => {});
      middleware(req, res, () => {});

      expect(statusCode).toBe(429);
    });
  });

  describe("Sanitization Middleware", () => {
    it("should sanitize query parameters", () => {
      const req = createMockRequest({
        query: { search: "<script>alert('xss')</script>" },
      }) as Request;

      const res = createMockResponse() as Response;

      sanitizationMiddleware(req, res, () => {
        expect(req.query.search).not.toContain("<");
        expect(req.query.search).not.toContain(">");
      });
    });

    it("should sanitize request body", () => {
      const req = createMockRequest({
        body: { text: 'Hello <img src=x onerror="alert(1)">' },
      }) as Request;

      const res = createMockResponse() as Response;

      sanitizationMiddleware(req, res, () => {
        expect((req.body as any).text).not.toContain("<");
        expect((req.body as any).text).not.toContain(">");
      });
    });

    it("should limit string length", () => {
      const req = createMockRequest({
        query: { search: "a".repeat(2000) },
      }) as Request;

      const res = createMockResponse() as Response;

      sanitizationMiddleware(req, res, () => {
        expect((req.query.search as string).length).toBeLessThanOrEqual(1000);
      });
    });
  });
});
