# Social Login Setup

## Google

1. Open [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create or select a project for Bookify.
3. Configure the OAuth consent screen / branding.
4. Create an OAuth Client ID of type `Web application`.
5. Add these values:
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:5000/api/auth/social/google/callback`
6. Copy the generated values into `backend/.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

Reference:
- [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google authorized redirect URI rules](https://support.google.com/cloud/answer/6158849?hl=en)

## X

1. Open [X Developer Portal](https://developer.x.com/).
2. Create or select your App.
3. Enable OAuth 2.0.
4. Use an App type that provides a client secret for server-side use.
5. Add this callback URL exactly:
   - `http://localhost:5000/api/auth/social/x/callback`
6. Copy these values into `backend/.env`:
   - `X_CLIENT_ID`
   - `X_CLIENT_SECRET`

Reference:
- [X OAuth 2.0 Authorization Code Flow with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [X user access token flow](https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/user-access-token)

## After updating .env

1. Restart the backend server.
2. Restart the frontend server if it is running.
3. Try `Continue with Google` or `Continue with X` again.
