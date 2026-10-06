#!/usr/bin/env bash
# Deploy Shell's Shift Diary to an Ubuntu/Debian VPS with a free DuckDNS domain + HTTPS.
#
# Usage (on the VPS):
#   curl -fsSL https://raw.githubusercontent.com/sfxhewitt/shells-hours-calculator/main/deploy/duckdns-vps.sh -o duckdns-vps.sh
#   sudo bash duckdns-vps.sh
#
# It asks for anything it needs; or pass it in up front:
#   sudo DUCK_SUB=shellshifts DUCK_TOKEN=xxxx EMAIL=you@example.com bash duckdns-vps.sh
#
# Safe to re-run: it updates the app to the latest version and keeps your settings.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/sfxhewitt/shells-hours-calculator.git}"
APP_DIR="/opt/shift-diary"
CONF_DIR="/etc/shift-diary"
CONF_FILE="$CONF_DIR/duckdns.env"

say()  { printf '\n\033[1;35m💖 %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Please run with sudo:  sudo bash $0"
command -v apt-get >/dev/null || fail "This script needs Ubuntu or Debian (apt-get not found)."

# Reuse answers from a previous run.
# shellcheck disable=SC1090
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

ask() { # ask VAR "Question" [secret]
  local var="$1" q="$2" secret="${3:-}" val="${!1:-}"
  while [ -z "$val" ]; do
    if [ -n "$secret" ]; then read -rsp "$q: " val; echo; else read -rp "$q: " val; fi
  done
  printf -v "$var" '%s' "$val"
}

echo "Get your subdomain and token from https://www.duckdns.org (sign in, add a domain, copy the token)."
ask DUCK_SUB   "DuckDNS subdomain (just the name, e.g. shellshifts)"
ask DUCK_TOKEN "DuckDNS token" secret
ask EMAIL      "Email for HTTPS certificate notices"
DUCK_SUB="${DUCK_SUB%.duckdns.org}"
DOMAIN="$DUCK_SUB.duckdns.org"

say "Installing nginx, git and certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx git curl certbot python3-certbot-nginx >/dev/null

say "Pointing $DOMAIN at this server"
cat > /usr/local/bin/duckdns-update <<'UPD'
#!/bin/sh
. /etc/shift-diary/duckdns.env
curl -fsS "https://www.duckdns.org/update?domains=$DUCK_SUB&token=$DUCK_TOKEN&ip="
UPD
chmod 700 /usr/local/bin/duckdns-update
result="$(curl -fsS "https://www.duckdns.org/update?domains=$DUCK_SUB&token=$DUCK_TOKEN&ip=" || true)"
if [ "$result" != "OK" ]; then
  rm -f "$CONF_FILE"
  fail "DuckDNS said '$result' — the subdomain or token is wrong. Check the spelling on duckdns.org, then run this again."
fi
# Only remember answers once DuckDNS has accepted them.
mkdir -p "$CONF_DIR"
umask 077
printf 'DUCK_SUB=%q\nDUCK_TOKEN=%q\nEMAIL=%q\n' "$DUCK_SUB" "$DUCK_TOKEN" "$EMAIL" > "$CONF_FILE"
umask 022

echo "*/5 * * * * root /usr/local/bin/duckdns-update >/dev/null 2>&1" > /etc/cron.d/duckdns
chmod 644 /etc/cron.d/duckdns

say "Getting the latest app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

say "Setting up nginx"
cat > /etc/nginx/sites-available/shift-diary <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $APP_DIR;
    index index.html;

    # Keep .git and other hidden files private, but allow certificate checks
    location ~ /\.(?!well-known) { deny all; }
    location ^~ /deploy/ { deny all; }

    # Service worker must never be cached, so app updates reach the phone
    location = /sw.js { add_header Cache-Control "no-cache"; }

    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
ln -sf /etc/nginx/sites-available/shift-diary /etc/nginx/sites-enabled/shift-diary
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  say "Opening the firewall"
  ufw allow OpenSSH >/dev/null
  ufw allow 'Nginx Full' >/dev/null
fi

say "Waiting for $DOMAIN to point here"
my_ip="$(curl -fsS4 https://api.ipify.org || true)"
for _ in $(seq 1 24); do
  dns_ip="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
  [ -n "$my_ip" ] && [ "$dns_ip" = "$my_ip" ] && break
  sleep 5
done
[ -n "$my_ip" ] && [ "$dns_ip" != "$my_ip" ] && echo "(DNS shows ${dns_ip:-nothing}, this server is $my_ip — trying anyway)"

say "Turning on HTTPS"
if ! certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect -n; then
  fail "Couldn't get the HTTPS certificate yet. Make sure ports 80 and 443 are open in your VPS provider's firewall, wait a few minutes, then run this again."
fi

say "All done! Open https://$DOMAIN on Michelle's phone, then 'Add to Home Screen' 🎀"
echo "To update the app later, just run this script again."
