export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type RateLimitedOperation = 'query' | 'stream' | 'history' | 'admin';
