import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('OAuth')

export type OAuthProvider = 'github' | 'google'

export interface OAuthUserInfo {
  providerAccountId: string
  email: string | null
  displayName: string | null
  avatarUrl: string | null
  accessToken: string
  refreshToken: string | null
}

interface ProviderConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  userInfoFn: (accessToken: string) => Promise<OAuthUserInfo>
}

function getGithubConfig(): ProviderConfig {
  return {
    clientId: config.oauth.github.clientId,
    clientSecret: config.oauth.github.clientSecret,
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'user:email'],
    userInfoFn: async (accessToken: string): Promise<OAuthUserInfo> => {
      const [userRes, emailsRes] = await Promise.all([
        fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        }),
        fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        }),
      ])

      if (!userRes.ok) throw new Error('Failed to fetch GitHub user info')
      const user = (await userRes.json()) as {
        id: number
        login: string
        name: string | null
        avatar_url: string | null
      }

      let email: string | null = null
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as {
          email: string
          primary: boolean
          verified: boolean
        }[]
        const primary = emails.find((e) => e.primary && e.verified)
        email = primary?.email ?? emails.find((e) => e.verified)?.email ?? null
      }

      return {
        providerAccountId: String(user.id),
        email,
        displayName: user.name || user.login,
        avatarUrl: user.avatar_url,
        accessToken,
        refreshToken: null,
      }
    },
  }
}

function getGoogleConfig(): ProviderConfig {
  return {
    clientId: config.oauth.google.clientId,
    clientSecret: config.oauth.google.clientSecret,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile'],
    userInfoFn: async (accessToken: string): Promise<OAuthUserInfo> => {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) throw new Error('Failed to fetch Google user info')
      const user = (await res.json()) as {
        id: string
        email: string | null
        name: string | null
        picture: string | null
      }
      return {
        providerAccountId: user.id,
        email: user.email,
        displayName: user.name,
        avatarUrl: user.picture,
        accessToken,
        refreshToken: null,
      }
    },
  }
}

const PROVIDER_CONFIGS: Record<OAuthProvider, () => ProviderConfig> = {
  github: getGithubConfig,
  google: getGoogleConfig,
}

/** Check whether a given OAuth provider has been configured with client credentials. */
export function isProviderConfigured(provider: OAuthProvider): boolean {
  const cfg =
    provider === 'github' ? config.oauth.github : provider === 'google' ? config.oauth.google : null
  return !!cfg && !!cfg.clientId && !!cfg.clientSecret
}

/** Build the authorization URL that the user's browser should be redirected to. */
export function getAuthorizationUrl(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
): string {
  const cfg = PROVIDER_CONFIGS[provider]()
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: cfg.scopes.join(' '),
    state,
    response_type: 'code',
  })
  // Google needs access_type=offline to return a refresh token
  if (provider === 'google') {
    params.set('access_type', 'offline')
    params.set('prompt', 'consent')
  }
  return `${cfg.authUrl}?${params.toString()}`
}

/** Exchange an authorization code for tokens and fetch the user's profile. */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<OAuthUserInfo> {
  const cfg = PROVIDER_CONFIGS[provider]()

  const body: Record<string, string> = {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: redirectUri,
  }

  // GitHub uses a different grant type parameter
  if (provider === 'github') {
    // GitHub doesn't require grant_type but we pass it anyway
  } else {
    body.grant_type = 'authorization_code'
  }

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    log.error(`Token exchange failed for ${provider}: ${tokenRes.status} ${text}`)
    throw new Error(`Token exchange failed: ${tokenRes.status}`)
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    error?: string
  }

  if (tokenData.error) {
    throw new Error(`OAuth error: ${tokenData.error}`)
  }

  const userInfo = await cfg.userInfoFn(tokenData.access_token)
  if (tokenData.refresh_token) {
    userInfo.refreshToken = tokenData.refresh_token
  }

  return userInfo
}
