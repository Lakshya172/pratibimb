set -e
export DEBIAN_FRONTEND=noninteractive
echo "=== apt packages ==="
apt-get install -y -qq nodejs npm xvfb wget bzip2 ca-certificates unzip \
  mesa-utils vulkan-tools libgtk-3-0t64 libdbus-glib-1-2 libasound2t64 \
  libx11-xcb1 libxtst6 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 2>&1 | tail -3
echo "node: $(node --version)  npm: $(npm --version)"
echo "=== Firefox (Mozilla official tarball, not snap) ==="
mkdir -p /opt
if [ ! -x /opt/firefox/firefox ]; then
  wget -q -O /tmp/firefox.tar.xz "https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US"
  tar -C /opt -xJf /tmp/firefox.tar.xz
fi
/opt/firefox/firefox --version 2>&1 | head -1
echo "=== Chrome for Testing 153.0.8010.12 (headful + headless shell) ==="
cd /opt
for pkg in chrome-linux64 chrome-headless-shell-linux64; do
  if [ ! -d "/opt/$pkg" ]; then
    wget -q -O "/tmp/$pkg.zip" "https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/$pkg.zip"
    unzip -q -o "/tmp/$pkg.zip" -d /opt
  fi
done
ls -d /opt/chrome-linux64 /opt/chrome-headless-shell-linux64 2>&1
/opt/chrome-linux64/chrome --version 2>&1 | head -1
echo "=== GPU diagnostics ==="
echo -n "vulkaninfo ICDs: "; (vulkaninfo --summary 2>/dev/null | grep -c "GPU id" || echo 0)
echo -n "glxinfo renderer: "; (DISPLAY=:0 glxinfo -B 2>/dev/null | grep -i "OpenGL renderer" || echo "unavailable")
echo "DONE"
