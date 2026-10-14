import { createPublicKey, type JsonWebKey, verify } from "node:crypto";

import type { AuthConfig } from "../config/config.js";

type FetchLike = (url: string) => Promise<Response>;

export interface AuthenticatedUser {
  subject: string;
  email?: string;
}

export class AuthError extends Error {}

const JWKS_TTL_MS = 10 * 60_000;
const JWKS_FORCE_COOLDOWN_MS = 30_000;
const JWKS_TIMEOUT_MS = 5_000;
const CLOCK_SKEW_S = 60;

const b64 = (value: string) => Buffer.from(value, "base64url");

/**
 * Verifies the aXet/Okta JWT (RS256) that the frontend already sends as a Bearer token. No second login is created:
 * keys come from the issuer's JWKS endpoint. Nothing here logs or returns the token.
 */
export class JwtVerifier {
  private keys: { jwks: JsonWebKey[]; fetchedAt: number } | null = null;

  constructor(
    private readonly config: AuthConfig,
    private readonly fetchImpl: FetchLike = (url) => fetch(url, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) }),
  ) {}

  private async loadKeys(force: boolean): Promise<JsonWebKey[]> {
    if (!force && this.keys && Date.now() - this.keys.fetchedAt < JWKS_TTL_MS) return this.keys.jwks;
    // Unknown `kid` values must not let a caller trigger a JWKS fetch per request.
    if (force && this.keys && Date.now() - this.keys.fetchedAt < JWKS_FORCE_COOLDOWN_MS) return this.keys.jwks;
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.jwksUrl);
    } catch {
      throw new AuthError("jwks unavailable");
    }
    if (!response.ok) throw new AuthError("jwks unavailable");
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    this.keys = { jwks: body.keys ?? [], fetchedAt: Date.now() };
    return this.keys.jwks;
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new AuthError("malformed token");
    let header: { alg?: string; kid?: string };
    let claims: { exp?: number; nbf?: number; iss?: string; aud?: string | string[]; sub?: string; email?: string };
    try {
      header = JSON.parse(b64(parts[0]).toString("utf8"));
      claims = JSON.parse(b64(parts[1]).toString("utf8"));
    } catch {
      throw new AuthError("malformed token");
    }
    if (header.alg !== "RS256") throw new AuthError("unsupported algorithm");

    let jwk = (await this.loadKeys(false)).find((key) => (key as { kid?: string }).kid === header.kid);
    if (!jwk) jwk = (await this.loadKeys(true)).find((key) => (key as { kid?: string }).kid === header.kid);
    if (!jwk) throw new AuthError("unknown signing key");

    const valid = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), b64(parts[2]));
    if (!valid) throw new AuthError("invalid signature");

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now) throw new AuthError("token expired");
    if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > now) throw new AuthError("token not yet valid");
    if (claims.iss !== this.config.issuer) throw new AuthError("unexpected issuer");
    if (this.config.audience) {
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.includes(this.config.audience)) throw new AuthError("unexpected audience");
    }
    return { subject: claims.sub ?? "", email: claims.email };
  }
}
