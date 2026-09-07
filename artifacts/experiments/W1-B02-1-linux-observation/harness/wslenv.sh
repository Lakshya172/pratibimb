echo "===DISTRO==="; grep -E '^(NAME|VERSION|VERSION_ID)=' /etc/os-release
echo "===KERNEL==="; uname -r
echo "===CPU==="; nproc
echo "===MEM==="; free -h | awk 'NR<=2'
echo "===GPU-nvidia-smi==="; (nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>&1) || echo "no nvidia-smi"
echo "===CUDA-LIBS==="; ls /usr/lib/wsl/lib/ 2>/dev/null | tr '\n' ' '; echo
echo "===DRI==="; ls /dev/dri 2>/dev/null | tr '\n' ' '; echo "(dri devices above)"
echo "===WSLg==="; echo "DISPLAY=$DISPLAY WAYLAND_DISPLAY=$WAYLAND_DISPLAY"; ls /tmp/.X11-unix 2>/dev/null | tr '\n' ' '; echo
echo "===NODE==="; (node --version 2>&1) || echo none
echo "===PY==="; python3 --version 2>&1
echo "===BROWSERS==="; for b in firefox google-chrome chromium chromium-browser; do command -v $b >/dev/null && echo "$b: $(command -v $b)"; done; echo "(none listed = none installed)"
echo "===APT-OK==="; (apt-get --version 2>&1 | head -1)
