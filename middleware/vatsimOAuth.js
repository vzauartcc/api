// Middleware class to handle VATSIM OAuth flow for user login.

import axios from "axios";

export default function (req, res, next) {
  const code = req.body.code;
  const vatsimOauthTokenEndpoint =
    process.env.VATSIM_AUTH_ENDPOINT + "/oauth/token";

  const redirectUrlHost = req.headers.host === "ids.zauartcc.org"
    ? "https://ids.zauartcc.org"
    : process.env.NODE_ENV === "beta"
      ? "https://staging.zauartcc.org"
      : process.env.NODE_ENV === "prod"
        ? "https://zauartcc.org"
        : "http://localhost:8080";

  const redirectUrl = `${redirectUrlHost}/login/verify`;

  if (!code) {
    res.status(400).send("No authorization code provided.");
  }

  if (!process.env.VATSIM_AUTH_ENDPOINT || !process.env.VATSIM_AUTH_CLIENT_ID) {
    res.status(500).send("Missing VATSIM auth environment variables.");
  }

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("client_id", process.env.VATSIM_AUTH_CLIENT_ID);
  params.append("code", code);
  params.append("redirect_uri", redirectUrl);

  if (req.headers.host === "ids.zauartcc.org" && process.env.VATSIM_AUTH_CLIENT_SECRET_IDS) {
    params.append("client_secret", process.env.VATSIM_AUTH_CLIENT_SECRET_IDS);
  } else {
    params.append("client_secret", process.env.VATSIM_AUTH_CLIENT_SECRET);
  }

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
