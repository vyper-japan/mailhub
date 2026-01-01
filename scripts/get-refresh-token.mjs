import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Missing env: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  process.exit(1);
}

const port = Number(process.env.OAUTH_LOCAL_PORT ?? "47865");
const redirectUri = `http://localhost:${port}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2({
  clientId,
  clientSecret,
  redirectUri,
});

const scope = "https://www.googleapis.com/auth/gmail.readonly";

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [scope],
});

console.log("");
console.log("Open this URL in your browser:");
console.log(authUrl);
console.log("");
console.log(`Waiting for redirect on: ${redirectUri}`);
console.log("");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", redirectUri);
    if (url.pathname !== "/oauth2callback") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end(`OAuth error: ${error}`);
      return;
    }

    if (!code) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Missing code");
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      "OK. You can close this tab and go back to your terminal.\n" +
        "If your terminal did not show a refresh_token, revoke access and run again.\n",
    );

    console.log("---- TOKENS ----");
    console.log("refresh_token:", tokens.refresh_token ?? "(none)");
    console.log("access_token:", tokens.access_token ? "(received)" : "(none)");
    console.log("scope:", tokens.scope ?? "(none)");
    console.log("expiry_date:", tokens.expiry_date ?? "(none)");
    console.log("token_type:", tokens.token_type ?? "(none)");
    console.log("---------------");
    console.log("");
    console.log("IMPORTANT:");
    console.log(
      "If refresh_token is (none), revoke the app at https://myaccount.google.com/permissions and retry.",
    );

    server.close();
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Error");
    console.error(e);
    server.close();
  }
});

server.listen(port, "127.0.0.1", () => {
  // ready
});


