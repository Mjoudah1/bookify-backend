# Social Login Setup

## Google

1. Open [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create or select a project for Bookify.
3. Configure the OAuth consent screen / branding.
4. Create an OAuth Client ID of type `Web application`.
5. Add these values:
   - Authorized JavaScript origins:
     - `https://bookify-frontend-877g.vercel.app`
     - `http://localhost:3000`
   - Authorized redirect URIs:
     - `https://<your-backend-domain>/api/auth/social/google/callback`
     - `http://localhost:5000/api/auth/social/google/callback`
6. Copy the generated values into `backend/.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

Reference:
- [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google authorized redirect URI rules](https://support.google.com/cloud/answer/6158849?hl=en)

## After updating .env

1. Restart the backend server.
2. Restart the frontend server if it is running.
3. Try `Continue with Google` again.

## Local development note

- The backend now detects the active frontend/backend host during social login, so local and deployed environments can share the same codebase.
- You still must register both localhost and deployed callback URLs inside Google provider settings.
