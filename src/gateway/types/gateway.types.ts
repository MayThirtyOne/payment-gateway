export interface GatewayConfig {
  name: string;
  weight: number; // Percentage weight for load distribution (0-100)
  enabled: boolean;
}

export interface GatewayStats {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  lastFailureTime: Date | null;
  windowStartTime: Date;
}

export interface GatewayHealth {
  name: string;
  isHealthy: boolean;
  successRate: number;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  disabledUntil: Date | null;
}

export interface GatewaySelectionResult {
  gateway: string;
  reason: string;
}

export const GATEWAY_CONFIG: GatewayConfig[] = [
  { name: 'razorpay', weight: 50, enabled: true },
  { name: 'payu', weight: 30, enabled: true },
  { name: 'cashfree', weight: 20, enabled: true },
];

// Configuration constants
export const HEALTH_CHECK_WINDOW_MINUTES = 15; // Window for calculating success rate
export const UNHEALTHY_COOLDOWN_MINUTES = 30; // Time to disable unhealthy gateway
export const SUCCESS_RATE_THRESHOLD = 0.9; // 90% success rate threshold
export const MIN_REQUESTS_FOR_HEALTH_CHECK = 5; // Minimum requests before health check applies
