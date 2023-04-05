// Middleware class to handle VATSIM OAuth flow for user login.

import axios from "axios";

export default function (req, res, next) {
  const code = req.body.code;
  let redirectUrl = "/login/verify";

  const vatsimOauthTokenEndpoint =
    process.env.VATSIM_AUTH_ENDPOINT + "/oauth/token";

  const allowedOrigins = {
    "https://ids.zauartcc.org": "https://ids.zauartcc.org/login/verify",
    "https://staging.zauartcc.org": "https://staging.zauartcc.org/login/verify",
    "https://zauartcc.org": "https://zauartcc.org/login/verify",
  };
  const defaultRedirectUrl = "http://localhost:8080/login/verify";
  
  const origin = req.headers.origin;
  if (origin) {
    redirectUrl = allowedOrigins[origin] || defaultRedirectUrl;
  } else {
    redirectUrl = defaultRedirectUrl;
  }

  if (!code) {
    res.status(400).send("No authorization code provided.");
  }

  const params = new URLSearchParams();
params.append("grant_type", "authorization_code");
params.append("code", code);
params.append("redirect_uri", redirectUrl);

let clientId = process.env.VATSIM_AUTH_CLIENT_ID;
let clientSecret = process.env.VATSIM_AUTH_CLIENT_SECRET;

if (req.headers.origin === "https://ids.zauartcc.org") {
  clientId = process.env.VATSIM_AUTH_CLIENT_ID_IDS;
  clientSecret = process.env.VATSIM_AUTH_CLIENT_SECRET_IDS;
}

params.append("client_id", clientId);
params.append("client_secret", clientSecret);
  axios
    .post(vatsimOauthTokenEndpoint, params)
    .then((response) => {
      req.oauth = response.data;
      next();
    })
    .catch((e) => {
      console.error(e);         //req.app.Sentry.captureException(e);
      res.status(500).send();
    });
}
