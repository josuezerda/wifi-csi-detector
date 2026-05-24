#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Setup Raspberry Pi 5 — WiFi CSI Presence Detector
# Ejecutar como: sudo bash setup_rpi.sh
# ═══════════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════════╗"
echo "║  🍓 Setup Raspberry Pi 5                         ║"
echo "║  WiFi CSI Presence Detector                      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Verificar que estamos en Raspberry Pi
if [ ! -f /proc/device-tree/model ]; then
    echo "⚠️  No parece ser una Raspberry Pi, pero continuamos..."
fi

# ─── 1. Actualizar sistema ──────────────────────────────
echo "📦 Actualizando sistema..."
sudo apt update && sudo apt upgrade -y

# ─── 2. Instalar Python y dependencias ──────────────────
echo "🐍 Instalando Python y dependencias..."
sudo apt install -y python3 python3-pip python3-venv git

# ─── 3. Clonar el proyecto ──────────────────────────────
PROJECT_DIR="$HOME/wifi-csi-detector"

if [ -d "$PROJECT_DIR" ]; then
    echo "📂 Proyecto ya existe, actualizando..."
    cd "$PROJECT_DIR"
    git pull
else
    echo "📥 Clonando proyecto..."
    # Reemplazar con la URL real del repo
    git clone https://github.com/TU_USUARIO/wifi-csi-detector.git "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi

# ─── 4. Crear entorno virtual ───────────────────────────
echo "🔧 Creando entorno virtual Python..."
python3 -m venv venv
source venv/bin/activate

# ─── 5. Instalar dependencias Python ────────────────────
echo "📦 Instalando dependencias Python..."
pip install --upgrade pip
pip install -r backend/requirements.txt

# ─── 6. Agregar usuario al grupo dialout (para serial) ──
echo "🔌 Configurando permisos serial..."
sudo usermod -a -G dialout $USER

# ─── 7. Instalar servicio systemd ───────────────────────
echo "⚙️  Instalando servicio systemd..."

SERVICE_FILE="/etc/systemd/system/wifi-detector.service"
sudo cp rpi/wifi_detector.service "$SERVICE_FILE"

# Reemplazar paths en el servicio
sudo sed -i "s|/home/pi|$HOME|g" "$SERVICE_FILE"
sudo sed -i "s|User=pi|User=$USER|g" "$SERVICE_FILE"

sudo systemctl daemon-reload
sudo systemctl enable wifi-detector.service

# ─── 8. Configurar firewall (opcional) ──────────────────
echo "🔥 Abriendo puertos 8080 y 8765..."
sudo ufw allow 8080/tcp 2>/dev/null || true
sudo ufw allow 8765/tcp 2>/dev/null || true

# ─── 9. Obtener IP ─────────────────────────────────────
IP=$(hostname -I | awk '{print $1}')

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✅ ¡Instalación completada!                     ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  Dashboard: http://$IP:8080          ║"
echo "║                                                  ║"
echo "║  Comandos útiles:                                ║"
echo "║  • Iniciar:  sudo systemctl start wifi-detector  ║"
echo "║  • Detener:  sudo systemctl stop wifi-detector   ║"
echo "║  • Estado:   sudo systemctl status wifi-detector ║"
echo "║  • Logs:     journalctl -u wifi-detector -f      ║"
echo "║                                                  ║"
echo "║  ⚠️  Reiniciá la Pi para aplicar permisos serial  ║"
echo "╚══════════════════════════════════════════════════╝"
